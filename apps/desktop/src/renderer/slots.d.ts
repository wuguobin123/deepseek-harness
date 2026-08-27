/**
 * Desktop renderer SlotMap declarations.
 *
 * Augments `@deepseek-ai/dsh-client-ui-slots`'s `SlotMap` and
 * `LocaleNamespaceMap` interfaces so the renderer-side code sees the
 * complete slot universe after the cordis plugins activate.
 *
 * Slot registrations come from the 33 webUI feature packages; the
 * runtime declares `root` implicitly. Each entry preserves the
 * `kind` (`single` | `list` | `chain` | `keyed`) and `scope`
 * (`root` | `session` | `session-maybe`) the registrants use.
 *
 * LocaleNamespaceMap mirrors the `NS` constants each feature exports
 * from `client/locales.ts`. Desktop React components bind through
 * `ctx.locale.bind(NS)` keyed by these strings.
 *
 * The file is read by every TypeScript source in
 * `apps/desktop/src/renderer/**` because tsconfig's `include` covers
 * the renderer root.
 */
import type { ThemeSnapshot, ThemePreference } from '@deepseek-ai/dsh-client-ui-theme/client'
import type { LocaleSnapshot, LocaleId } from '@deepseek-ai/dsh-client-locale/client'
import type { ILayout } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { IConversation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { UseProjection, SnapshotSelectorHook } from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionId } from '@deepseek-ai/dsh-client-connection/client'
import type { DirectoryFlowOwnerProps } from '@deepseek-ai/dsh-client-ui-workspace/client'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  /** Session standard kit supplied to every session-scoped slot occupant. */
  interface SessionStandardProps {
    useSession: SnapshotSelectorHook<unknown>
    sessionId: SessionId
    useProjection: UseProjection
  }

  /** Session-maybe standard kit — current session may be absent. */
  interface SessionMaybeStandardProps {
    useSession?: SnapshotSelectorHook<unknown>
    sessionId: SessionId | undefined
    useProjection: UseProjection
  }

  /** Global standard kit supplied to every root-scoped slot occupant. */
  interface GlobalStandardProps {
    useSessions: SnapshotSelectorHook<unknown>
    useWorkspaces: SnapshotSelectorHook<unknown>
  }

  // ---- ui-layout child slots ----
  interface SlotMap {
    /** Sidebar column occupant (single, root scope). */
    'sidebar': { kind: 'single'; scope: 'root' }
    /** Conversation column occupant (single, session-maybe scope). */
    'conversation': { kind: 'single'; scope: 'session-maybe' }
    /** Details column occupant (single, session scope). */
    'details': { kind: 'single'; scope: 'session' }
    /** Frame-wide floating overlay list (root scope). */
    'shell.overlay': { kind: 'list'; scope: 'root' }
  }

  // ---- ui-conversation child seats ----
  interface SlotMap {
    'conversation.session': { kind: 'single'; scope: 'session' }
    'conversation.session.header': { kind: 'single'; scope: 'session' }
    'conversation.session.header.lineage': { kind: 'single'; scope: 'session' }
    'conversation.session.header.actions': { kind: 'list'; scope: 'session' }
    'conversation.session.header.utilities': { kind: 'list'; scope: 'session' }
    'conversation.composer': { kind: 'chain'; scope: 'session' }
    'conversation.composer.bar': { kind: 'single'; scope: 'session-maybe' }
    'conversation.composer.dock': { kind: 'list'; scope: 'session' }
    'conversation.input.overlay': { kind: 'list'; scope: 'session' }
    'conversation.input.dock': { kind: 'list'; scope: 'session' }
    'conversation.input.left': { kind: 'list'; scope: 'session' }
    'conversation.input.right': { kind: 'list'; scope: 'session' }
    'conversation.input.attachments': { kind: 'single'; scope: 'session-maybe' }
    'conversation.input.plan': { kind: 'single'; scope: 'session' }
    'conversation.input.model': { kind: 'single'; scope: 'session' }
    'conversation.hero.brand.mark': { kind: 'single'; scope: 'root' }
    'conversation.hero.workspace': { kind: 'single'; scope: 'root' }
    'conversation.hero.agentPreset': { kind: 'single'; scope: 'root' }
    'conversation.view': { kind: 'list'; scope: 'session' }
    'conversation.chat.node': { kind: 'keyed'; scope: 'session' }
    'conversation.chat.assistant-actions': { kind: 'list'; scope: 'session' }
    'conversation.message.images': { kind: 'single'; scope: 'session' }
    'conversation.details.tool': { kind: 'single'; scope: 'session' }
    'tool.call.toolview': { kind: 'keyed'; scope: 'session' }
  }

  // ---- ui-sidebar child seats ----
  interface SlotMap {
    'sidebar.workspaces': { kind: 'single'; scope: 'root' }
    'sidebar.sessions': { kind: 'single'; scope: 'root' }
    'sidebar.settings': { kind: 'single'; scope: 'root' }
    'sidebar.footer.action': { kind: 'list'; scope: 'root'; owner: { wide: boolean } }
    'sidebar.skills': { kind: 'single'; scope: 'root' }
  }

  // ---- ui-workspace directory-flow holes (both single, root scope) ----
  interface SlotMap {
    'conversation.hero.workspace.directoryFlow': { kind: 'single'; scope: 'root'; owner: DirectoryFlowOwnerProps }
    'sidebar.workspaces.directoryFlow': { kind: 'single'; scope: 'root'; owner: DirectoryFlowOwnerProps }
  }

  // ---- settings seats ----
  interface SlotMap {
    'settings': { kind: 'single'; scope: 'root' }
    'settings.section': { kind: 'list'; scope: 'root' }
    'settings.onboarding': { kind: 'list'; scope: 'root' }
    'settings.plugins.tab': { kind: 'list'; scope: 'root' }
    'settings.plugin.item': { kind: 'list'; scope: 'root' }
    'settings.general.item': { kind: 'list'; scope: 'root' }
    'settings.models.item': { kind: 'list'; scope: 'root' }
    'settings.agentPreset.item': { kind: 'list'; scope: 'root' }
    'settings.permission.item': { kind: 'list'; scope: 'root' }
    'settings.skill.item': { kind: 'list'; scope: 'root' }
  }

  // ---- locale namespaces ----
  interface LocaleNamespaceMap {
    conversation: unknown
    settings: unknown
    'settings.agentPreset': unknown
    'settings.permission': unknown
    'settings.skill': unknown
    commands: unknown
    goal: unknown
    inputTrigger: unknown
    jobs: unknown
    messageFeedback: unknown
    modelSelection: unknown
    plan: unknown
    reference: unknown
    subagent: unknown
    tool: unknown
    trajectory: unknown
    userQuestions: unknown
    workflowRun: unknown
    sidebar: unknown
    workspace: unknown
    attachment: unknown
    agentPreset: unknown
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Locale runtime: bind/dictionary/snapshot. */
    locale: {
      bind: (namespace: string) => { t: (key: string) => string }
      snapshot: LocaleSnapshot
      setLocale: (id: LocaleId) => void
    }
    /** Theme runtime: token snapshot + preference. */
    theme: {
      getTheme: () => ThemeSnapshot
      setMode: (mode: ThemePreference) => void
      modes: ThemePreference[]
    }
    /** Layout controller. */
    layout: ILayout
    /** Conversation controller. */
    conversation: IConversation
    /** UI renderer — exposes mount(container) → unmount(). */
    uiRenderer: {
      mount: (container: HTMLElement) => () => void
    }
  }

  interface Events {
    /** A slot's definition or registration set changed. */
    'slots/changed'(key: string): void
    /** A connection generation was (re-)established. */
    'connection/reset'(): void
    /** Theme snapshot changed. */
    'theme/change'(snapshot: ThemeSnapshot): void
    /** Locale snapshot changed. */
    'locale/change'(snapshot: LocaleSnapshot): void
  }
}
