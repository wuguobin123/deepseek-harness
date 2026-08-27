import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  IconSearchOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './PluginInventorySettingsTab.module.css'

/** Browser-safe account plugin row returned by the factory API. */
export interface AccountPlugin {
  readonly pluginId: string
  readonly title: string
  readonly description: string
  readonly version: string
  readonly systemDefault: boolean
  readonly installed: boolean
}

/** Authenticated plugin-factory operations used by the account settings tab. */
export interface PluginFactorySettingsTabInjected {
  list: () => Promise<readonly AccountPlugin[]>
  install: (pluginId: string) => Promise<void>
  uninstall: (pluginId: string) => Promise<void>
}

/** Full props assembled by the Settings slot renderer. */
export type PluginFactorySettingsTabProps =
  PropsRuntime<'settings.plugins.tab'>
  & PropsLocale<'settings.pluginInventory'>
  & InjectFace<PluginFactorySettingsTabInjected>

type ViewState =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly items: readonly AccountPlugin[] }

/** Account-scoped plugin catalog with install and uninstall controls. */
export function PluginFactorySettingsTab({
  list,
  install,
  uninstall,
  t,
}: PluginFactorySettingsTabProps): ReactNode {
  const [request, setRequest] = useState(0)
  const [query, setQuery] = useState('')
  const [pending, setPending] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [state, setState] = useState<ViewState>({ status: 'loading' })

  useEffect(() => {
    let current = true
    void Promise.resolve().then(() => list()).then(
      (items) => { if (current) setState({ status: 'ready', items }) },
      () => { if (current) setState({ status: 'error' }) },
    )
    return () => { current = false }
  }, [list, request])

  const normalized = query.trim().toLocaleLowerCase()
  const items = useMemo(() => state.status === 'ready'
    ? state.items.filter(item => [item.pluginId, item.title, item.description]
      .some(value => value.toLocaleLowerCase().includes(normalized)))
    : [], [normalized, state])

  const mutate = async (item: AccountPlugin): Promise<void> => {
    setPending(item.pluginId)
    setNotice(null)
    try {
      if (item.installed) await uninstall(item.pluginId)
      else await install(item.pluginId)
      setNotice(t('newSessionNotice'))
      setState({ status: 'loading' })
      setRequest(value => value + 1)
    } catch {
      setNotice(t('mutationError'))
    } finally {
      setPending(null)
    }
  }

  return (
    <div className={css.section} aria-busy={state.status === 'loading'}>
      <p className={css.factoryIntro}>{t('factoryIntro')}</p>
      {notice === null ? null : <p className={css.notice} role="status">{notice}</p>}
      {state.status === 'loading' ? <p className={css.status}>{t('loading')}</p> : null}
      {state.status === 'error' ? (
        <div className={css.failure}>
          <p role="alert">{t('error')}</p>
          <button type="button" onClick={() => { setState({ status: 'loading' }); setRequest(value => value + 1) }}>{t('retry')}</button>
        </div>
      ) : null}
      {state.status === 'ready' ? (
        <div className={css.catalog}>
          <label className={css.search}>
            <IconSearchOutline16 aria-hidden="true" />
            <span className={css.visuallyHidden}>{t('search')}</span>
            <input type="search" value={query} placeholder={t('search')} aria-label={t('search')} onChange={(event) => { setQuery(event.currentTarget.value) }} />
          </label>
          <div className={css.catalogHeading}><h3>{t('factoryCatalog')}</h3><span>{items.length}</span></div>
          {state.items.length === 0 ? <p className={css.status}>{t('empty')}</p> : null}
          {state.items.length > 0 && items.length === 0 ? <p className={css.status}>{t('emptySearch')}</p> : null}
          <ul className={css.factoryCards}>
            {items.map(item => (
              <li className={css.factoryCard} key={item.pluginId} data-plugin-id={item.pluginId}>
                <div className={css.factoryCopy}>
                  <strong>{item.title}</strong>
                  <p>{item.description}</p>
                  <span>{t('version')} {item.version}</span>
                </div>
                {item.systemDefault ? (
                  <span className={css.systemTag}>{t('systemDefault')}</span>
                ) : (
                  <button
                    type="button"
                    disabled={pending === item.pluginId}
                    data-installed={item.installed ? 'true' : 'false'}
                    onClick={() => { void mutate(item) }}
                  >
                    {pending === item.pluginId ? t('saving') : t(item.installed ? 'uninstall' : 'install')}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
