/** Validate the repository's specification-driven development documents. */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
import { load } from 'js-yaml'

export interface SddViolation { file: string; message: string }
export interface SddValidationResult { files: string[]; violations: SddViolation[] }

const KINDS = new Set(['feature', 'capability', 'integration'])
const STATUSES = new Set(['draft', 'approved', 'implemented', 'retired'])
const MODES = new Set(['read', 'write'])
const RISKS = new Set(['R1', 'R2', 'R3'])
const APPROVALS = new Set(['none', 'per-call'])

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}
function nonEmpty(value: unknown): boolean { return typeof value === 'string' ? value.trim() !== '' : object(value) !== undefined && Object.keys(value as object).length > 0 }
function entries(value: unknown): Array<{ id: string; value: unknown }> {
  if (Array.isArray(value)) {
    const items: unknown[] = value
    return items.map((item, index) => {
      const id = object(item)?.id
      return { id: typeof id === 'string' ? id : '', value: item ?? index }
    })
  }
  const record = object(value)
  return record === undefined ? [] : Object.entries(record).map(([id, item]) => ({ id, value: item }))
}
function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(strings)
  const record = object(value)
  return record === undefined ? [] : ['path', 'file', 'files', 'paths'].flatMap(key => strings(record[key]))
}

/** Recursively find English SDD markdown documents below a directory. */
export function findSddFiles(specsRoot: string): string[] {
  if (!statSafe(specsRoot)?.isDirectory()) return []
  const result: string[] = []
  for (const name of readdirSync(specsRoot)) {
    const file = resolve(specsRoot, name)
    const stat = statSafe(file)
    if (stat?.isDirectory()) result.push(...findSddFiles(file))
    else if (stat?.isFile() && name.endsWith('.md') && !name.endsWith('.zh.md')) result.push(file)
  }
  return result.sort()
}
function statSafe(file: string) { try { return statSync(file) } catch { return undefined } }

function frontmatter(file: string): Record<string, unknown> {
  const text = readFileSync(file, 'utf8')
  const lines = text.split(/\r?\n/)
  if (lines[0] !== '---') throw new Error('missing YAML frontmatter')
  const end = lines.indexOf('---', 1)
  if (end < 0) throw new Error('unterminated YAML frontmatter')
  const parsed: unknown = load(lines.slice(1, end).join('\n'))
  const record = object(parsed)
  if (record === undefined) throw new Error('frontmatter must be a YAML object')
  return record
}

function validatePath(value: string, root: string, violations: SddViolation): void {
  const target = resolve(root, value)
  if (isAbsolute(value) || (relative(root, target) !== '' && (relative(root, target).startsWith(`..${requireSep()}`) || relative(root, target) === '..'))) {
    violations.message += `; path must stay inside repository: ${value}`
  } else if (!statSafe(target)) violations.message += `; path does not exist: ${value}`
}
function requireSep(): string { return process.platform === 'win32' ? '\\' : '/' }

/** Validate all SDD files under `root/docs/specs`, returning actionable diagnostics. */
export function validateSdd(root = process.cwd()): SddValidationResult {
  const specs = resolve(root, 'docs/specs')
  const files = findSddFiles(specs)
  const violations: SddViolation[] = []
  const ids = new Map<string, string>()
  const add = (file: string, message: string) => violations.push({ file: relative(root, file), message })
  const unique = (file: string, kind: string, id: unknown) => {
    if (typeof id !== 'string' || id.trim() === '') return add(file, `${kind} id must be a non-empty string`)
    const previous = ids.get(id)
    if (previous) add(file, `duplicate ${kind} id "${id}" (already declared in ${previous})`)
    else ids.set(id, relative(root, file))
  }
  for (const file of files) {
    let meta: Record<string, unknown>
    try { meta = frontmatter(file) } catch (error) { add(file, `${error instanceof Error ? error.message : String(error)}; add valid YAML frontmatter`); continue }
    const sdd = object(meta.sdd)
    if (sdd === undefined) { add(file, 'missing top-level sdd object'); continue }
    unique(file, 'document', sdd.id)
    if (typeof sdd.kind !== 'string' || !KINDS.has(sdd.kind)) add(file, `kind must be one of ${[...KINDS].join(', ')}`)
    if (typeof sdd.status !== 'string' || !STATUSES.has(sdd.status)) add(file, `status must be one of ${[...STATUSES].join(', ')}`)
    if (!Array.isArray(sdd.owners) || sdd.owners.length === 0 || sdd.owners.some(item => !nonEmpty(item))) add(file, 'owners must be a non-empty list')
    for (const [field, label] of [['requirements', 'requirement'], ['acceptance', 'acceptance']] as const) {
      const list = entries(sdd[field])
      if (list.length === 0) { add(file, `${field} must be non-empty`); continue }
      for (const item of list) {
        unique(file, label, item.id)
        const record = object(item.value)
        if (record === undefined || !nonEmpty(record.text ?? record.description ?? record.statement)) add(file, `${label} ${item.id || '<missing>'} must declare non-empty text`)
        if (field === 'acceptance') {
          const acceptanceEvidence = strings(record?.evidence)
          if (sdd.status === 'implemented' && acceptanceEvidence.length === 0) add(file, `implemented acceptance ${item.id || '<missing>'} must have non-empty evidence`)
          for (const path of acceptanceEvidence) {
            const diagnostic: SddViolation = { file: relative(root, file), message: '' }
            validatePath(path, root, diagnostic)
            if (diagnostic.message) add(file, `acceptance ${item.id || '<missing>'} evidence reference ${path}${diagnostic.message}`)
          }
        }
      }
    }
    for (const field of ['decisions', 'evidence']) for (const path of strings(sdd[field])) {
      const diagnostic: SddViolation = { file: relative(root, file), message: '' }
      validatePath(path, root, diagnostic)
      if (diagnostic.message) add(file, `${field} reference ${path}${diagnostic.message}`)
    }
    if (sdd.kind === 'integration') validateIntegration(file, sdd, add, unique)
  }
  if (files.length === 0) violations.push({ file: 'docs/specs', message: 'no English .md SDD documents found; add at least one specification' })
  return { files: files.map(file => relative(root, file)), violations }
}

function validateIntegration(
  file: string,
  sdd: Record<string, unknown>,
  add: (file: string, message: string) => void,
  unique: (file: string, kind: string, id: unknown) => void,
): void {
  for (const field of ['identity', 'credentials']) if (!nonEmpty(sdd[field])) add(file, `${field} must be a non-empty object or declaration`)
  const operations = entries(sdd.operations)
  if (operations.length === 0) { add(file, 'operations must be non-empty'); return }
  for (const item of operations) {
    unique(file, 'operation', item.id)
    const op = object(item.value)
    if (op === undefined) { add(file, `operation ${item.id || '<missing>'} must be an object`); continue }
    if (!MODES.has(String(op.mode))) add(file, `operation ${item.id || '<missing>'} mode must be read or write`)
    if (!RISKS.has(String(op.risk))) add(file, `operation ${item.id || '<missing>'} risk must be R1, R2, or R3`)
    if (!APPROVALS.has(String(op.approval))) add(file, `operation ${item.id || '<missing>'} approval must be none or per-call`)
    for (const field of ['idempotency', 'retry', 'compensation', 'audit']) {
      if (!nonEmpty(op[field])) add(file, `operation ${item.id || '<missing>'} requires non-empty ${field}`)
    }
    if (op.mode === 'read' && (op.risk !== 'R1' || op.approval !== 'none')) add(file, `read operation ${item.id} must be R1 with none approval`)
    if (op.mode === 'write') {
      if (op.risk === 'R1') add(file, `write operation ${item.id} cannot be R1`)
      if (op.approval !== 'per-call') add(file, `write operation ${item.id} must use per-call approval`)
      if (op.idempotency === 'not-applicable') add(file, `write operation ${item.id} idempotency cannot be not-applicable`)
      if (op.risk === 'R2' && op.compensation === 'not-applicable') add(file, `R2 write operation ${item.id} compensation cannot be not-applicable`)
    }
  }
}

if (import.meta.main) {
  const result = validateSdd()
  if (result.violations.length) {
    for (const violation of result.violations) console.error(`verify-sdd: ${violation.file}: ${violation.message}; fix the SDD frontmatter.`)
    process.exitCode = 1
  } else console.log(`verify-sdd: validated ${result.files.length} document(s).`)
}
