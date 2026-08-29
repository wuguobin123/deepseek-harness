import { useCallback, useEffect, useMemo, useState } from 'react'
import type { InstalledSkillRecord, SkillDirectoryInstallResult } from '../../../shared/contracts'
import css from './SkillManagementSection.module.css'

export interface SkillManagementApi {
  listSkills(): Promise<{ ok: true; value: readonly InstalledSkillRecord[] } | { ok: false; error: { message: string } }>
  installSkill(): Promise<{ ok: true; value: SkillDirectoryInstallResult | { status: 'cancelled' } } | { ok: false; error: { message: string } }>
}

export interface SkillManagementSectionProps {
  api: SkillManagementApi
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Settings page for the on-device Skill inventory. */
export function SkillManagementSection({ api }: SkillManagementSectionProps): React.JSX.Element {
  const [skills, setSkills] = useState<readonly InstalledSkillRecord[]>([])
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  const refresh = useCallback(async (): Promise<void> => {
    setBusy(true)
    setError(undefined)
    const result = await api.listSkills()
    if (result.ok) setSkills(result.value)
    else setError(result.error.message)
    setBusy(false)
  }, [api])
  useEffect(() => { void refresh() }, [refresh])

  const visible = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    if (!normalized) return skills
    return skills.filter(skill => (
      [skill.directoryName, skill.name, skill.description]
        .some(value => value?.toLocaleLowerCase().includes(normalized))
    ))
  }, [query, skills])

  const install = async (): Promise<void> => {
    setBusy(true)
    setError(undefined)
    const result = await api.installSkill()
    if (!result.ok) setError(result.error.message)
    else if (result.value.status !== 'cancelled') await refresh()
    setBusy(false)
  }

  return (
    <section className={css.section} data-testid="settings-skills">
      <h2 className={css.heading}>技能</h2>
      <p className={css.intro}>本机正式运行时的技能清单；它不等于当前 Session 已加载的技能。</p>
      <div className={css.actions}>
        <input aria-label="搜索技能" placeholder="搜索技能" value={query} onChange={(event) => { setQuery(event.target.value) }} />
        <button type="button" onClick={() => { void refresh() }} disabled={busy}>刷新</button>
        <button type="button" onClick={() => { void install() }} disabled={busy}>安装 Skill 目录</button>
      </div>
      {error ? <p className={css.error} role="alert">{error}</p> : null}
      <ul className={css.list} data-testid="settings-skills-list">
        {visible.map(skill => (
          <li key={skill.directoryName} className={skill.valid ? css.valid : css.invalid} data-testid="settings-skill-item">
            <div><strong>{skill.valid && skill.name ? `/${skill.name}` : skill.directoryName}</strong><span>{skill.valid ? '有效' : '无效'}</span></div>
            {skill.description ? <p>{skill.description}</p> : null}
            <small>{skill.fileCount} 个文件 · {formatBytes(skill.totalBytes)}{skill.error ? ` · ${skill.error}` : ''}</small>
          </li>
        ))}
      </ul>
      {visible.length === 0 ? <p className={css.empty}>暂无匹配的技能。</p> : null}
    </section>
  )
}
