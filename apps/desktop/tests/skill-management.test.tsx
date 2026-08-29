// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SkillManagementSection, type SkillManagementApi } from '../src/renderer/features/skill-management/SkillManagementSection'

let host: HTMLDivElement
let root: Root
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => { root.unmount() }); host.remove() })

describe('SkillManagementSection', () => {
  it('searches inventory and installs then refreshes', async () => {
    const listSkills = vi.fn()
      .mockResolvedValueOnce({ ok: true, value: [
        { directoryName: 'alpha-dir', name: 'alpha', description: 'first', fileCount: 2, totalBytes: 2048, valid: true },
        { directoryName: 'broken', fileCount: 1, totalBytes: 4, valid: false, error: 'bad SKILL.md' },
      ] })
      .mockResolvedValueOnce({ ok: true, value: [{ directoryName: 'new-dir', name: 'new', description: 'new skill', fileCount: 1, totalBytes: 10, valid: true }] })
    const api: SkillManagementApi = { listSkills, installSkill: vi.fn().mockResolvedValue({ ok: true, value: { status: 'installed', skill: { directoryName: 'new-dir', name: 'new', fileCount: 1, totalBytes: 10, valid: true } } }) }
    await act(async () => { root.render(<SkillManagementSection api={api} />) })
    expect(host.querySelectorAll('[data-testid="settings-skill-item"]')).toHaveLength(2)
    const input = host.querySelector('input') as HTMLInputElement
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    await act(async () => {
      setValue?.call(input, 'broken')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(host.textContent).toContain('broken')
    expect(host.textContent).not.toContain('/alpha')
    await act(async () => { setValue?.call(input, ''); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })) })
    await act(async () => { (host.querySelector('button:last-of-type') as HTMLButtonElement).click() })
    expect(api.installSkill).toHaveBeenCalledOnce()
    expect(listSkills).toHaveBeenCalledTimes(2)
    expect(host.textContent).toContain('/new')
  })
})
