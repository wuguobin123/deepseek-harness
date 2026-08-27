import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { validateSdd } from './verify-sdd.ts'

function fixture(frontmatter: string, files: Record<string, string> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-sdd-'))
  mkdirSync(join(root, 'docs/specs'), { recursive: true })
  writeFileSync(join(root, 'docs/specs/example.md'), frontmatter)
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(join(root, name, '..'), { recursive: true })
    writeFileSync(join(root, name), content)
  }
  return root
}
const valid = (extra = '') => `---\nsdd:\n  id: spec-one\n  kind: feature\n  status: implemented\n  owners: [team]\n  requirements:\n    - id: req-one\n      text: A requirement\n  acceptance:\n    - id: ac-one\n      text: It works\n      evidence: [evidence/result.md]\n  evidence: [evidence/result.md]\n${extra}---\n# Example\n`

describe('verify-sdd', () => {
  it('accepts all repository templates as copy-ready draft specifications', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-sdd-templates-'))
    const specs = join(root, 'docs/specs')
    mkdirSync(specs, { recursive: true })
    for (const name of ['feature-spec', 'capability-spec', 'integration-spec']) {
      const template = readFileSync(join(import.meta.dirname, '..', 'docs/sdd/templates', `${name}.md`), 'utf8')
      const yaml = /```yaml\n([\s\S]*?)\n```/.exec(template)?.[1]
      if (yaml === undefined) throw new Error(`${name}.md must contain one YAML template`)
      writeFileSync(join(specs, `${name}.md`), `---\n${yaml}\n---\n`)
    }
    expect(validateSdd(root).violations).toEqual([])
  })
  it('accepts a valid document and integration operation combinations', () => {
    const root = fixture(valid('  decisions: [evidence/decision.md]\n'), {
      'evidence/result.md': 'ok', 'evidence/decision.md': 'ok',
    })
    expect(validateSdd(root).violations).toEqual([])
  })
  it('rejects missing frontmatter, duplicate IDs, and missing implemented evidence', () => {
    const root = fixture('no frontmatter')
    expect(validateSdd(root).violations.map(item => item.message).join('\n')).toMatch(/frontmatter/)
    const duplicates = fixture(valid(), { 'evidence/result.md': 'ok' })
    writeFileSync(join(duplicates, 'docs/specs/second.md'), valid().replace('spec-one', 'spec-two').replace('ac-one', 'ac-two'))
    expect(validateSdd(duplicates).violations.map(item => item.message).join('\n')).toMatch(/duplicate requirement id "req-one"/)
    const duplicate = fixture(valid().replace('evidence: [evidence/result.md]', 'evidence: []'))
    expect(validateSdd(duplicate).violations.map(item => item.message).join('\n')).toMatch(/non-empty evidence/)
  })
  it('accepts the documented kinds and lifecycle statuses', () => {
    for (const kind of ['feature', 'capability', 'integration']) {
      for (const status of ['draft', 'approved', 'implemented', 'retired']) {
        const integration = kind === 'integration'
          ? '  identity: service-account\n  credentials: credential-provider\n  operations:\n    - id: operation-read\n      mode: read\n      risk: R1\n      approval: none\n      idempotency: safe\n      retry: bounded\n      compensation: none\n      audit: required\n'
          : ''
        const root = fixture(valid(integration)
          .replace('  kind: feature\n', `  kind: ${kind}\n`)
          .replace('  status: implemented\n', `  status: ${status}\n`), { 'evidence/result.md': 'ok' })
        expect(validateSdd(root).violations).toEqual([])
      }
    }
  })
  it('rejects undocumented kinds and lifecycle statuses', () => {
    const root = fixture(valid().replace('  kind: feature\n', '  kind: process\n').replace('  status: implemented\n', '  status: accepted\n'), {
      'evidence/result.md': 'ok',
    })
    const messages = validateSdd(root).violations.map(item => item.message).join('\n')
    expect(messages).toMatch(/kind must be one of feature, capability, integration/)
    expect(messages).toMatch(/status must be one of draft, approved, implemented, retired/)
  })
  it('rejects missing and escaping repository paths', () => {
    const root = fixture(valid('  decisions: [missing.md, ../outside.md]\n'))
    const messages = validateSdd(root).violations.map(item => item.message).join('\n')
    expect(messages).toMatch(/does not exist/)
    expect(messages).toMatch(/stay inside repository/)
  })
  it('rejects invalid integration operations', () => {
    const root = fixture(valid().replace('  kind: feature\n', '  kind: integration\n  identity: {}\n  credentials: token\n  operations:\n    - id: write-low\n      mode: write\n      risk: R1\n      approval: none\n      idempotency: not-applicable\n      retry: bounded\n      compensation: required\n      audit: required\n    - id: write-r2\n      mode: write\n      risk: R2\n      approval: per-call\n      idempotency: required\n      retry: bounded\n      compensation: not-applicable\n      audit: required\n    - id: read-high\n      mode: read\n      risk: R2\n      approval: per-call\n      idempotency: safe\n      retry: bounded\n      compensation: none\n      audit: required\n'))
    const messages = validateSdd(root).violations.map(item => item.message).join('\n')
    expect(messages).toMatch(/identity/)
    expect(messages).toMatch(/cannot be R1/)
    expect(messages).toMatch(/per-call/)
    expect(messages).toMatch(/idempotency cannot be not-applicable/)
    expect(messages).toMatch(/R2 write operation write-r2 compensation cannot be not-applicable/)
    expect(messages).toMatch(/read operation read-high must be R1 with none approval/)
  })
  it('fails when specs is empty', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-sdd-empty-'))
    expect(validateSdd(root).violations.map(item => item.message).join('\n')).toMatch(/no English/)
  })
})
