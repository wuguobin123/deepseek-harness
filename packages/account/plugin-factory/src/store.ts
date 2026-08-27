import { DatabaseSync } from 'node:sqlite'
import { mkdir, open } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

/** Monotonic schema version for the account plugin installation database. */
export const SCHEMA_VERSION = 1
const APPLICATION_ID = 0x44534850 // DSHP

async function createFile(path: string): Promise<void> {
  try {
    const handle = await open(path, 'wx', 0o600)
    await handle.close()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
}

/**
 * Open the account installation database and reject incompatible files.
 * @param path - SQLite path or `:memory:` for tests.
 * @returns initialized database handle.
 */
export async function openPluginDatabase(path: string): Promise<DatabaseSync> {
  const actual = path === ':memory:' ? path : resolve(path)
  if (actual !== ':memory:') { await mkdir(dirname(actual), { recursive: true, mode: 0o700 }); await createFile(actual) }
  const db = new DatabaseSync(actual)
  try {
    db.exec('PRAGMA journal_mode = WAL')
    const version = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
    const application = (db.prepare('PRAGMA application_id').get() as { application_id: number }).application_id
    if (application !== 0 && application !== APPLICATION_ID) throw new Error(`plugin database has application id ${application}`)
    if (version !== 0 && version !== SCHEMA_VERSION) throw new Error(`plugin database has schema version ${version}, incompatible with this build (${SCHEMA_VERSION})`)
    db.exec('CREATE TABLE IF NOT EXISTS account_plugins (user_id TEXT NOT NULL, plugin_id TEXT NOT NULL, installed_at INTEGER NOT NULL, PRIMARY KEY (user_id, plugin_id)) STRICT')
    if (version === 0) { db.exec(`PRAGMA application_id = ${APPLICATION_ID}`); db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`) }
    return db
  } catch (error) { db.close(); throw error }
}

/** SQLite operations for account installation rows. */
export class PluginStore {
  /** Bind operations to one opened database. */
  constructor(private readonly db: DatabaseSync) {}
  /**
   * Read one account's installation set.
   * @param userId - authoritative account id.
   * @returns installed plugin ids.
   */
  installed(userId: string): Set<string> {
    return new Set((this.db.prepare('SELECT plugin_id FROM account_plugins WHERE user_id = ?').all(userId) as Array<{ plugin_id: string }>).map(row => row.plugin_id))
  }
  /**
   * Record one optional installation idempotently.
   * @param userId - authoritative account id.
   * @param pluginId - catalog id.
   */
  install(userId: string, pluginId: string): void {
    this.db.prepare('INSERT OR IGNORE INTO account_plugins (user_id, plugin_id, installed_at) VALUES (?, ?, ?)').run(userId, pluginId, Date.now())
  }
  /**
   * Remove one optional installation idempotently.
   * @param userId - authoritative account id.
   * @param pluginId - catalog id.
   */
  uninstall(userId: string, pluginId: string): void { this.db.prepare('DELETE FROM account_plugins WHERE user_id = ? AND plugin_id = ?').run(userId, pluginId) }
  /** Close the owned SQLite handle. */
  close(): void { this.db.close() }
}
