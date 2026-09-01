import { useEffect, useState, type ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './BusinessSkillsSettingsTab.module.css'

/** Account-owned business Skill row exposed to the browser. */
export interface BusinessSkillView {
  readonly skillId: string
  readonly title: string
  readonly activeVersion: string
  readonly revision: number
  readonly enabled: boolean
}
/** Authenticated operations for business Skill management. */
export interface BusinessSkillsSettingsTabInjected {
  list(this: void): Promise<BusinessSkillView[]>
  validate(this: void, manifestText: string): Promise<{ valid: boolean; issues: string[] }>
  publish(this: void, manifestText: string, expectedRevision?: number): Promise<void>
  disable(this: void, skillId: string, expectedRevision: number): Promise<void>
  rollback(this: void, skillId: string, targetVersion: string, expectedRevision: number): Promise<void>
}
export type BusinessSkillsSettingsTabProps = PropsRuntime<'settings.plugins.tab'>
  & PropsLocale<'settings.businessSkills'>
  & InjectFace<BusinessSkillsSettingsTabInjected>
type State = { status: 'loading' } | { status: 'error' } | { status: 'ready'; items: BusinessSkillView[] }

/** Render editable, account-scoped business Skill management controls. */
export function BusinessSkillsSettingsTab(props: BusinessSkillsSettingsTabProps): ReactNode {
  const [state, setState] = useState<State>({ status: 'loading' })
  const [request, setRequest] = useState(0)
  const [manifestText, setManifestText] = useState('')
  const [targetVersion, setTargetVersion] = useState('')
  const [issues, setIssues] = useState<string[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, setPending] = useState<string | null>(null)
  useEffect(() => {
    let current = true
    void props.list().then(
      (items) => { if (current) setState({ status: 'ready', items }) },
      () => { if (current) setState({ status: 'error' }) },
    )
    return () => { current = false }
  }, [props.list, request])
  const refresh = (): void => {
    setState({ status: 'loading' })
    setRequest(value => value + 1)
  }
  const run = async (key: string, action: () => Promise<void>, success: string): Promise<void> => {
    setPending(key)
    setNotice(null)
    try {
      await action()
      setNotice(success)
      refresh()
    } catch {
      setNotice(props.t('operationError'))
    } finally {
      setPending(null)
    }
  }
  const check = async (): Promise<void> => {
    setPending('validate')
    setNotice(null)
    try {
      const result = await props.validate(manifestText)
      setIssues(result.issues)
      setNotice(result.valid ? props.t('valid') : props.t('invalid'))
    } catch {
      setNotice(props.t('operationError'))
      setIssues([])
    } finally {
      setPending(null)
    }
  }
  return <div className={css.section} aria-busy={state.status === 'loading'}>
    {state.status === 'loading' ? <p className={css.status}>{props.t('loading')}</p> : null}
    {state.status === 'error' ? <div className={css.failure}>
      <p role="alert">{props.t('error')}</p>
      <button type="button" onClick={refresh}>{props.t('retry')}</button>
    </div> : null}
    {notice !== null ? <p className={css.notice} role="status">{notice}</p> : null}
    {issues.length > 0 ? <ul className={css.issues} aria-label={props.t('issues')}>
      {issues.map((issue, index) => <li key={`${index}-${issue}`}>{issue}</li>)}
    </ul> : null}
    <div className={css.editor}>
      <label htmlFor="business-skill-manifest">{props.t('manifest')}</label>
      <textarea
        id="business-skill-manifest"
        value={manifestText}
        onChange={(event) => { setManifestText(event.currentTarget.value) }}
      />
      <div className={css.actions}>
        <button type="button" disabled={pending !== null} onClick={() => { void check() }}>
          {pending === 'validate' ? props.t('validating') : props.t('validate')}
        </button>
        <button
          type="button"
          disabled={pending !== null || manifestText.trim() === ''}
          onClick={() => { void run('publish', () => props.publish(manifestText), props.t('published')) }}
        >
          {pending === 'publish' ? props.t('publishing') : props.t('publish')}
        </button>
      </div>
    </div>
    {state.status === 'ready' ? <div className={css.catalog}>
      <div className={css.heading}><h3>{props.t('tab')}</h3><span>{state.items.length}</span></div>
      <ul className={css.cards}>
        {state.items.length === 0 ? <li className={css.status}>{props.t('empty')}</li> : state.items.map(item => (
          <li className={css.card} key={item.skillId} data-skill-id={item.skillId}>
            <div className={css.row}>
              <strong title={item.skillId}>{item.title}</strong>
              <span className={css.meta}>{item.skillId}</span>
              <span>{item.activeVersion}</span>
              <span>{item.revision}</span>
              <span className={css.tag} data-enabled={item.enabled ? 'true' : 'false'}>
                {props.t(item.enabled ? 'enabledTag' : 'disabledTag')}
              </span>
              <button
                type="button"
                disabled={pending !== null}
                onClick={() => {
                  void run(
                    `disable:${item.skillId}`,
                    () => props.disable(item.skillId, item.revision),
                    props.t('disabledNotice'),
                  )
                }}
              >
                {pending === `disable:${item.skillId}` ? props.t('saving') : props.t('disable')}
              </button>
            </div>
            <div className={css.actions}>
              <label className={css.rollback}>{props.t('targetVersion')}
                <input
                  value={targetVersion}
                  onChange={(event) => { setTargetVersion(event.currentTarget.value) }}
                />
              </label>
              <button
                type="button"
                disabled={pending !== null || targetVersion.trim() === ''}
                onClick={() => {
                  void run(
                    `rollback:${item.skillId}`,
                    () => props.rollback(item.skillId, targetVersion, item.revision),
                    props.t('rolledBack'),
                  )
                }}
              >
                {pending === `rollback:${item.skillId}` ? props.t('saving') : props.t('rollback')}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div> : null}
  </div>
}
