import { useEffect, useRef } from 'react'
import type { ReactElement } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { DirectoryFlowOwnerProps } from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'

export const inject = ['slots']

function ImportFlow(props: DirectoryFlowOwnerProps): ReactElement | null {
  const location = (props as DirectoryFlowOwnerProps & { location?: 'local' | 'cloud' }).location ?? 'local'
  const onWorkspace = (props as DirectoryFlowOwnerProps & { onWorkspace?: (workspace: unknown) => void }).onWorkspace
  const armed = useRef(false)
  const latest = useRef(props)
  latest.current = props
  useEffect(() => {
    if (!props.open) { armed.current = false; return }
    if (armed.current) return
    armed.current = true
    window.workbenchApi.importDirectory({ location }).then((result) => {
      if (!result.ok) latest.current.onError(result.error.message)
      else {
        const value = result.value as { status?: string; workspace?: { path?: string; workspaceId?: string } }
        if (value.status === 'cancelled') latest.current.onCancel()
        else if (value.workspace?.workspaceId && onWorkspace) onWorkspace(value.workspace)
        else if (value.workspace?.path) latest.current.onPicked(value.workspace.path)
        else latest.current.onError('打开目录失败')
      }
    }, error => latest.current.onError(error instanceof Error ? error.message : String(error)))
  }, [props.open])
  return null
}

export function apply(ctx: ClientContext): void {
  ctx.slots.inject('conversation.hero.workspace.directoryFlow', () =>
    ctx.slots.inject('sidebar.workspaces.directoryFlow', function* () {
      const injected = { name: 'conversation.hero.workspace.directoryFlow' as const, inject: () => ({}) }
      yield ctx.slots.register(injected, ImportFlow)
      yield ctx.slots.register({ ...injected, name: 'sidebar.workspaces.directoryFlow' }, ImportFlow)
    }))
}
