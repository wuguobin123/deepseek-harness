/** SQLite ownership, format validation, and transaction helpers. */
import { closeSync, mkdirSync, openSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { KnowledgeError } from '@deepseek-ai/dsh-knowledge'

/** Current physical schema version. */
export const KNOWLEDGE_SQLITE_SCHEMA_VERSION = 1
/** SQLite application identifier reserved by this provider. */
export const KNOWLEDGE_SQLITE_APPLICATION_ID = 1_146_245_970

const SCHEMA = `
CREATE TABLE knowledge_bases(
  id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  PRIMARY KEY(id, tenant_id, subject_id)
) STRICT;
CREATE TABLE documents(
  id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  kb_id TEXT NOT NULL,
  title TEXT NOT NULL,
  content_type TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  revision_id TEXT NOT NULL,
  PRIMARY KEY(id, tenant_id, subject_id),
  FOREIGN KEY(kb_id, tenant_id, subject_id)
    REFERENCES knowledge_bases(id, tenant_id, subject_id)
) STRICT;
CREATE TABLE revisions(
  id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  index_revision TEXT NOT NULL,
  model TEXT NOT NULL,
  model_revision TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  PRIMARY KEY(id, tenant_id, subject_id),
  FOREIGN KEY(document_id, tenant_id, subject_id)
    REFERENCES documents(id, tenant_id, subject_id)
) STRICT;
CREATE TABLE chunks(
  id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  revision_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  text TEXT NOT NULL,
  vector TEXT NOT NULL,
  PRIMARY KEY(id, tenant_id, subject_id),
  FOREIGN KEY(document_id, tenant_id, subject_id)
    REFERENCES documents(id, tenant_id, subject_id),
  FOREIGN KEY(revision_id, tenant_id, subject_id)
    REFERENCES revisions(id, tenant_id, subject_id)
) STRICT;
CREATE TABLE jobs(
  id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  kb_id TEXT NOT NULL,
  status TEXT NOT NULL,
  document_id TEXT,
  revision_id TEXT,
  error TEXT,
  PRIMARY KEY(id, tenant_id, subject_id),
  FOREIGN KEY(kb_id, tenant_id, subject_id)
    REFERENCES knowledge_bases(id, tenant_id, subject_id)
) STRICT;
CREATE VIRTUAL TABLE chunks_fts USING fts5(
  text,
  tenant_id UNINDEXED,
  subject_id UNINDEXED,
  chunk_id UNINDEXED
);
`

/** Open a compatible database and initialize a new file atomically. */
export function openKnowledgeDatabase(path: string): DatabaseSync {
  const filePath = path === ':memory:' ? path : resolve(path)
  if (filePath !== ':memory:') preparePath(filePath)
  const db = new DatabaseSync(filePath)
  try {
    db.exec('PRAGMA foreign_keys=ON')
    const applicationId = pragma(db, 'application_id')
    const schemaVersion = pragma(db, 'user_version')
    if (applicationId === 0 && schemaVersion === 0 && !hasUserObjects(db)) initialize(db)
    else if (applicationId !== KNOWLEDGE_SQLITE_APPLICATION_ID || schemaVersion !== KNOWLEDGE_SQLITE_SCHEMA_VERSION) {
      throw new KnowledgeError('incompatible knowledge database schema', 'KNOWLEDGE_SCHEMA_INCOMPATIBLE')
    }
    if (filePath !== ':memory:') db.exec('PRAGMA journal_mode=WAL')
    return db
  } catch (error) {
    db.close()
    throw error
  }
}

/** Execute synchronous mutations atomically and preserve the original failure. */
export function transaction<T>(db: DatabaseSync, mutate: () => T): T {
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = mutate()
    db.exec('COMMIT')
    return result
  } catch (error) {
    try {
      db.exec('ROLLBACK')
    } catch {
      // SQLite may already have rolled back the failed transaction.
    }
    throw error
  }
}

function initialize(db: DatabaseSync): void {
  transaction(db, () => {
    db.exec(SCHEMA)
    db.exec(`PRAGMA user_version=${KNOWLEDGE_SQLITE_SCHEMA_VERSION}`)
    // Stamp ownership last so a partially initialized file is never accepted.
    db.exec(`PRAGMA application_id=${KNOWLEDGE_SQLITE_APPLICATION_ID}`)
  })
}

function pragma(db: DatabaseSync, name: 'application_id' | 'user_version'): number {
  const row = db.prepare(`PRAGMA ${name}`).get() as Record<string, unknown> | undefined
  const value = row?.[name]
  if (typeof value !== 'number') throw new KnowledgeError(`invalid SQLite ${name}`, 'KNOWLEDGE_SCHEMA_INCOMPATIBLE')
  return value
}

function hasUserObjects(db: DatabaseSync): boolean {
  return db.prepare(`
    SELECT name FROM sqlite_schema
    WHERE name NOT LIKE 'sqlite_%' AND type IN ('table', 'view', 'index', 'trigger')
    LIMIT 1
  `).get() !== undefined
}

function preparePath(path: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  try {
    const handle = openSync(path, 'wx', 0o600)
    closeSync(handle)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
}
