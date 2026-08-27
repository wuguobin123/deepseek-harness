/** Account-scoped custom-model settings for authenticated remote clients. */

import { useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { Button, IconPlusOutline16, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import { AccountModelsStore } from './account-store.ts'
import type { CustomModelView, CustomModelsApi } from './account-store.ts'
import { apiKeyFailure } from './apiKey.ts'
import type { en } from './locales.ts'
import styles from './ModelsSection.module.css'

/** Dependencies injected by the settings-section slot. */
export interface AccountModelsInjected {
  /** Account custom-model store. */
  controller: AccountModelsStore
  hooks: {
    /** Store snapshot bound by the slot renderer. */
    snapshot: AccountModelsStore['store']
  }
  /** Account-only custom-model RPCs. */
  api: { customModels: CustomModelsApi }
  /** Localized settings copy. */
  t: (key: keyof typeof en) => string
}

/** Props delivered by the settings-section slot. */
export type AccountModelsProps = Partial<InjectFace<AccountModelsInjected>>

interface CustomModelDraft {
  label: string
  baseURL: string
  api: 'openai-completions' | 'openai-responses'
  upstreamModel: string
  apiKey: string
}

function emptyDraft(): CustomModelDraft {
  return {
    label: '',
    baseURL: '',
    api: 'openai-completions',
    upstreamModel: '',
    apiKey: '',
  }
}

/** Render the authenticated account's custom-model section. */
export function AccountModelsSection(props: AccountModelsProps): ReactNode {
  const { controller, useSnapshot, api, t } = props
  if (controller === undefined || useSnapshot === undefined || api === undefined || t === undefined) return null
  return <AccountModelsLoaded injected={{ controller, useSnapshot, api, t }} />
}

function AccountModelsLoaded({ injected }: { injected: InjectFace<AccountModelsInjected> }): ReactNode {
  const { controller, api, t } = injected
  const state = injected.useSnapshot(snapshot => snapshot)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string>()
  const [deleteTarget, setDeleteTarget] = useState<CustomModelView>()
  const [draft, setDraft] = useState<CustomModelDraft>(emptyDraft)

  if (state.status === 'idle') void controller.load()

  const closeEditor = (): void => {
    if (busy) return
    setOpen(false)
    setFailure(undefined)
    setDraft(emptyDraft())
  }

  const update = <K extends keyof CustomModelDraft>(key: K, value: CustomModelDraft[K]): void => {
    setDraft(previous => ({ ...previous, [key]: value }))
  }

  const apply = (event: FormEvent): void => {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setFailure(undefined)
    void api.customModels.create({
      label: draft.label.trim(),
      baseURL: draft.baseURL.trim(),
      api: draft.api,
      upstreamModel: draft.upstreamModel.trim(),
      apiKey: draft.apiKey.trim(),
    }).then(async (response) => {
      if (!response.result.ok) {
        setFailure(response.result.error.message)
        return
      }
      setDraft(emptyDraft())
      setOpen(false)
      await controller.load()
    }, (error: unknown) => {
      setFailure(error instanceof Error ? error.message : String(error))
    }).finally(() => { setBusy(false) })
  }

  const remove = (): void => {
    if (deleteTarget === undefined || busy) return
    setBusy(true)
    setFailure(undefined)
    void api.customModels.remove({ customModelId: deleteTarget.customModelId }).then(async (response) => {
      if (!response.result.ok) {
        setFailure(response.result.error.message)
        return
      }
      if (!response.result.value.removed) {
        setFailure(t('accountDeleteFailed'))
        return
      }
      setDeleteTarget(undefined)
      await controller.load()
    }, (error: unknown) => {
      setFailure(error instanceof Error ? error.message : String(error))
    }).finally(() => { setBusy(false) })
  }

  if (state.status === 'error') {
    return (
      <div className={styles['section']}>
        <h2 className={styles['title']}>{t('title')}</h2>
        <p className={styles['error']}>{`${t('loadFailed')}: ${state.error ?? ''}`}</p>
        <button type="button" className={styles['secondaryButton']} onClick={() => { void controller.load() }}>
          {t('retry')}
        </button>
      </div>
    )
  }

  const active = state.items.filter(item => item.revoked === null)
  const deleteName = deleteTarget?.label ?? ''
  const keyFailure = apiKeyFailure(draft.apiKey)
  return (
    <div className={styles['section']}>
      <h2 className={styles['title']}>{t('title')}</h2>
      <p className={styles['intro']}>{t('remoteIntro')}</p>
      {active.length === 0 && state.status === 'ready'
        ? <p className={styles['intro']}>{t('accountEmpty')}</p>
        : null}
      <ul className={styles['rows']}>
        {active.map(item => (
          <li className={styles['rowCard']} key={item.customModelId}>
            <div className={styles['rowHead']}>
              <span className={styles['rowIdentity']}>
                <span className={styles['rowName']}>{item.label}</span>
              </span>
              <button
                type="button"
                className={styles['dangerButton']}
                disabled={busy}
                onClick={() => {
                  setFailure(undefined)
                  setDeleteTarget(item)
                }}
              >
                {t('remove')}
              </button>
            </div>
            <p className={styles['intro']}>{`${item.api} · ${item.upstreamModel} · ${item.baseURL}`}</p>
          </li>
        ))}
      </ul>
      {open
        ? (
          <form className={styles['addCard']} onSubmit={apply}>
            <label className={styles['field']}>
              <span className={styles['fieldLabel']}>{t('customDisplayName')}</span>
              <input className={styles['input']} value={draft.label} onChange={(event) => { update('label', event.target.value) }} />
            </label>
            <label className={styles['field']}>
              <span className={styles['fieldLabel']}>{t('baseUrl')}</span>
              <input className={styles['input']} type="url" value={draft.baseURL} onChange={(event) => { update('baseURL', event.target.value) }} placeholder="https://api.example.com/v1" />
            </label>
            <label className={styles['field']}>
              <span className={styles['fieldLabel']}>{t('customApi')}</span>
              <select className={`${styles['input']} ${styles['selectInput']}`} value={draft.api} onChange={(event) => { update('api', event.target.value as CustomModelDraft['api']) }}>
                <option value="openai-completions">openai-completions</option>
                <option value="openai-responses">openai-responses</option>
              </select>
            </label>
            <label className={styles['field']}>
              <span className={styles['fieldLabel']}>{t('modelId')}</span>
              <input className={styles['input']} value={draft.upstreamModel} onChange={(event) => { update('upstreamModel', event.target.value) }} />
            </label>
            <label className={styles['field']}>
              <span className={styles['fieldLabel']}>{t('keyInput')}</span>
              <input className={styles['input']} type="password" autoComplete="new-password" value={draft.apiKey} onChange={(event) => { update('apiKey', event.target.value) }} />
            </label>
            <p className={styles['intro']}>{t('accountKeyHint')}</p>
            {keyFailure === undefined ? null : <p className={styles['error']}>{t(keyFailure)}</p>}
            {failure === undefined ? null : <p className={styles['error']}>{failure}</p>}
            <div className={styles['rowActions']}>
              <Button variant="outline" disabled={busy} onClick={closeEditor}>{t('cancel')}</Button>
              <Button type="submit" disabled={busy || keyFailure !== undefined || !draft.label.trim() || !draft.baseURL.trim() || !draft.upstreamModel.trim() || !draft.apiKey.trim()}>
                {busy ? t('applying') : t('apply')}
              </Button>
            </div>
          </form>
        )
        : (
          <button
            type="button"
            className={styles['addButton']}
            onClick={() => {
              setFailure(undefined)
              setOpen(true)
            }}
          >
            <IconPlusOutline16 size={14} />
            {t('accountAdd')}
          </button>
        )}
      <Modal
        open={deleteTarget !== undefined}
        onClose={() => {
          if (busy) return
          setDeleteTarget(undefined)
          setFailure(undefined)
        }}
        title={t('accountDeleteTitle').replace('{model}', deleteName)}
        description={t('accountDeleteDescription').replace('{model}', deleteName)}
        closeLabel={t('close')}
        className={styles['deleteDialog'] as string}
        footer={(
          <>
            <Button variant="outline" autoFocus disabled={busy} onClick={() => { setDeleteTarget(undefined); setFailure(undefined) }}>
              {t('cancel')}
            </Button>
            <Button variant="outline" className={styles['deleteConfirm']} disabled={busy} onClick={remove}>
              {busy ? t('accountDeleting') : t('accountDeleteConfirm')}
            </Button>
          </>
        )}
      >
        {failure === undefined ? null : <p className={styles['error']}>{failure}</p>}
      </Modal>
    </div>
  )
}
