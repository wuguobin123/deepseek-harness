// @vitest-environment jsdom
/** Remote account custom-model form and destructive-action behavior. */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { AccountModelsSection } from '../src/client/AccountModelsSection.tsx'
import type { AccountModelsInjected } from '../src/client/AccountModelsSection.tsx'
import { AccountModelsStore } from '../src/client/account-store.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const t: AccountModelsInjected['t'] = key => en[key]

function ok<T>(value: T): { result: { ok: true; value: T } } {
  return { result: { ok: true, value } }
}

describe('AccountModelsSection', () => {
  it('creates an account model, clears the secret draft, and confirms removal', async () => {
    const item = {
      customModelId: 'cm_0123456789abcdef',
      label: 'Private model',
      api: 'openai-responses' as const,
      baseURL: 'https://api.example.com/v1/',
      upstreamModel: 'model-a',
      created: 1,
      revoked: null,
    }
    let items: typeof item[] = []
    const list = vi.fn(async () => ok({ items }))
    const create = vi.fn(async () => {
      items = [item]
      return ok(item)
    })
    const remove = vi.fn(async () => {
      items = []
      return ok({ removed: true })
    })
    const api = { customModels: { list, create, remove } } as never
    const controller = new AccountModelsStore(api)
    render(
      <AccountModelsSection
        controller={controller}
        useSnapshot={bindSnapshotSelector(controller.store)}
        api={api}
        t={t}
      />,
    )

    await waitFor(() => { expect(screen.getByText(en.accountEmpty)).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: en.accountAdd }))
    fireEvent.change(screen.getByLabelText(en.customDisplayName), { target: { value: ' Private model ' } })
    fireEvent.change(screen.getByLabelText(en.baseUrl), { target: { value: ' https://api.example.com/v1 ' } })
    fireEvent.change(screen.getByLabelText(en.customApi), { target: { value: 'openai-responses' } })
    fireEvent.change(screen.getByLabelText(en.modelId), { target: { value: ' model-a ' } })
    fireEvent.change(screen.getByLabelText(en.keyInput), { target: { value: ' sk-private ' } })
    fireEvent.click(screen.getByRole('button', { name: en.apply }))

    await waitFor(() => { expect(screen.getByText('Private model')).toBeTruthy() })
    expect(create).toHaveBeenCalledWith({
      label: 'Private model',
      baseURL: 'https://api.example.com/v1',
      api: 'openai-responses',
      upstreamModel: 'model-a',
      apiKey: 'sk-private',
    })
    expect(screen.queryByDisplayValue('sk-private')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: en.remove }))
    expect(screen.getByRole('dialog').textContent).toContain('Private model')
    expect(remove).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: en.accountDeleteConfirm }))
    await waitFor(() => { expect(screen.getByText(en.accountEmpty)).toBeTruthy() })
    expect(remove).toHaveBeenCalledWith({ customModelId: item.customModelId })
  })
})
