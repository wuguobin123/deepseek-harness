// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BusinessSkillsSettingsTab } from '../src/client/BusinessSkillsSettingsTab.tsx'
import type { BusinessSkillsSettingsTabProps } from '../src/client/BusinessSkillsSettingsTab.tsx'
import { en, type BusinessSkillsLocaleKey } from '../src/client/locales.ts'

afterEach(cleanup)
const t = ((key: BusinessSkillsLocaleKey): string => en[key]) as BusinessSkillsSettingsTabProps['t']
const base = { skillId: 'sales', title: '销售助手', activeVersion: '1.2.0', revision: 4, enabled: true }
const props = (overrides: Partial<BusinessSkillsSettingsTabProps>): BusinessSkillsSettingsTabProps => ({
  t,
  list: async () => [base],
  validate: async () => ({ valid: true, issues: [] }),
  publish: async () => {},
  disable: async () => {},
  rollback: async () => {},
  ...overrides,
} as BusinessSkillsSettingsTabProps)

describe('BusinessSkillsSettingsTab', () => {
  it('lists skills and performs validation, publish, disable and rollback', async () => {
    const validate = vi.fn(async () => ({ valid: false, issues: ['缺少 title'] }))
    const publish = vi.fn(async () => {})
    const disable = vi.fn(async () => {})
    const rollback = vi.fn(async () => {})
    render(<BusinessSkillsSettingsTab {...props({ validate, publish, disable, rollback })} />)
    expect(await screen.findByText('销售助手')).toBeTruthy()
    fireEvent.change(screen.getByLabelText(en.manifest), { target: { value: '{"id":"sales"}' } })
    fireEvent.click(screen.getByRole('button', { name: en.validate }))
    await waitFor(() => { expect(validate).toHaveBeenCalledWith('{"id":"sales"}') })
    expect(screen.getByText('缺少 title')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.publish }))
    await waitFor(() => { expect(publish).toHaveBeenCalledWith('{"id":"sales"}') })
    fireEvent.click(screen.getByRole('button', { name: en.disable }))
    await waitFor(() => { expect(disable).toHaveBeenCalledWith('sales', 4) })
    fireEvent.change(screen.getByLabelText(en.targetVersion), { target: { value: '1.1.0' } })
    fireEvent.click(screen.getByRole('button', { name: en.rollback }))
    await waitFor(() => { expect(rollback).toHaveBeenCalledWith('sales', '1.1.0', 4) })
  })

  it('does not expose operation errors', async () => {
    render(<BusinessSkillsSettingsTab {...props({
      list: async () => { throw new Error('secret-token') },
    })} />)
    expect((await screen.findByRole('alert')).textContent).toBe(en.error)
    expect(screen.queryByText('secret-token')).toBeNull()
  })
})
