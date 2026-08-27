/**
 * Native directory picker bridge.
 *
 * Re-implements webUI's `<DirectoryPickerNative>` — a thin React
 * surface that calls the Electron IPC `dialog:openDirectory` handler.
 * The result is posted back through the same `onPick` contract used by
 * `DirectoryPickerBrowse` so both pickers are interchangeable.
 */
import React from 'react'

export interface DirectoryPickerNativeProps {
  open: boolean
  title?: string
  defaultPath?: string
  onPick: (path: string) => void
  onCancel: () => void
}

export function DirectoryPickerNative({
  open,
  title,
  defaultPath,
  onPick,
  onCancel,
}: DirectoryPickerNativeProps): React.JSX.Element | null {
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!open) return
    setBusy(true)
    setError(null)
    void window.workbenchApi.request(
      'dialog.openDirectory',
      { title, defaultPath },
    ).then((res: unknown) => {
      const response = res as { ok: boolean; value?: { path?: string | null }; error?: { message: string } }
      setBusy(false)
      if (response.ok) {
        const v = response.value as { path: string | null }
        if (v.path) onPick(v.path)
        else onCancel()
      } else {
        setError(response.error?.message ?? '目录选择失败')
        onCancel()
      }
    })
  }, [defaultPath, onCancel, onPick, open, title])

  if (!open) return null
  return (
    <section className="directory-picker directory-picker--native" data-testid="directory-picker-native">
      <p className="directory-picker__status">{busy ? '正在打开系统对话框…' : '已关闭'}</p>
      {error ? <p className="directory-picker__error" role="alert">{error}</p> : null}
    </section>
  )
}
