/**
 * Conversation root.
 *
 * Re-implements webUI's `<ConversationRoot>`. The frame-level
 * `conversation` slot (declared by `ui-layout`) is what this component
 * occupies. We render:
 *   - `conversation.hero.*` seats when no session is active (brand mark,
 *     workspace picker, agent preset picker)
 *   - `conversation.session` chain (header, body, composer) when a
 *     session is open
 *
 * Reads / writes go through `ctx.conversation` (the runtime's
 * conversation controller) and `ctx.sessions.open(id)`. Tool calls,
 * attachments, message feedback, and the user-questions takeover are
 * surface facets that plug into the slots declared by the
 * conversation + tool + user-questions packages.
 *
 * Phase C wires the inner slots. This file is the top-level skeleton.
 */

export interface ConversationRootProps {
  /** Slot occupant props injected by the framework. */
  useSession?: () => unknown
  sessionId?: string
  useSessions: () => unknown
  useWorkspaces: () => unknown
}

export function ConversationRoot({ useSession, sessionId }: ConversationRootProps): React.JSX.Element {
  if (!sessionId || !useSession) {
    return <NoSessionHero />
  }
  return <LiveSessionRoot sessionId={sessionId} useSession={useSession} />
}

function NoSessionHero(): React.JSX.Element {
  return (
    <section className="conversation-hero" data-testid="conversation-hero">
      <header className="conversation-hero__header">
        {/* ui-brand-official brand mark */}
        <BrandMark />
        {/* ui-workspace workspace picker */}
        <WorkspacePicker />
        {/* ui-agent-preset preset picker */}
        <AgentPresetPicker />
      </header>
      <main className="conversation-hero__body" data-testid="conversation-hero-body">
        <p className="conversation-hero__lead">
          选择一个工作区与智能体预设，开始一段新的会话。
        </p>
        <ul className="conversation-hero__shortcuts">
          <li>使用左侧工作区面板切换上下文。</li>
          <li>按 <kbd>⌘</kbd>+<kbd>K</kbd> 打开命令面板。</li>
          <li>在输入框中按 <kbd>/</kbd> 触发命令，按 <kbd>@</kbd> 引用文件。</li>
        </ul>
      </main>
    </section>
  )
}

function LiveSessionRoot({ sessionId, useSession }: { sessionId: string; useSession: () => unknown }): React.JSX.Element {
  return (
    <section className="conversation-root" data-session-id={sessionId} data-testid="conversation-root">
      <SessionHeader sessionId={sessionId} />
      <SessionBody sessionId={sessionId} useSession={useSession} />
      <SessionComposer sessionId={sessionId} />
    </section>
  )
}

function SessionHeader({ sessionId }: { sessionId: string }): React.JSX.Element {
  return (
    <header className="conversation-session__header" data-testid="conversation-session-header">
      <div className="conversation-session__lineage" data-testid="conversation-session-lineage">
        {/* ui-conversation: lineage chain (subagent lineage breadcrumb) */}
      </div>
      <h1 className="conversation-session__title" title={sessionId}>
        {sessionId.slice(0, 12)}
      </h1>
      <div className="conversation-session__actions" data-testid="conversation-session-actions">
        {/* ui-conversation: actions list — model picker, plan toggle, etc. */}
      </div>
    </header>
  )
}

function SessionBody({ sessionId, useSession }: { sessionId: string; useSession: () => unknown }): React.JSX.Element {
  return (
    <div className="conversation-chat" data-testid="conversation-chat">
      <ChatMessageList sessionId={sessionId} useSession={useSession} />
    </div>
  )
}

function ChatMessageList({ sessionId, useSession }: { sessionId: string; useSession: () => unknown }): React.JSX.Element {
  // The chat node slot is keyed by conversation-node id; ui-tool registers
  // its tool-call tree occupant, ui-message-feedback registers its like /
  // dislike row, ui-attachment registers the attachment rail. The list
  // itself iterates the conversation snapshot from the runtime.
  const snap = useSession() as { messages?: Array<{ id: string; role: 'user' | 'assistant' | 'tool'; text?: string }> } | undefined
  const messages = snap?.messages ?? []

  return (
    <ul className="conversation-chat__list" data-testid="conversation-chat-list" data-session-id={sessionId}>
      {messages.map(m => (
        <li key={m.id} className={`conversation-chat__row conversation-chat__row--${m.role}`} data-testid="conversation-chat-row" data-role={m.role}>
          {m.text ?? ''}
        </li>
      ))}
    </ul>
  )
}

function SessionComposer({ sessionId }: { sessionId: string }): React.JSX.Element {
  return (
    <footer className="conversation-composer" data-testid="conversation-composer" data-session-id={sessionId}>
      <div className="conversation-composer__bar">
        <PlanToggle />
        <ModelSelector />
      </div>
      <div className="conversation-composer__dock">
        <AttachmentDock />
        <InputTriggerPicker />
      </div>
      <textarea
        className="conversation-composer__input"
        placeholder="向助手提问…（Enter 发送，Shift+Enter 换行）"
        data-testid="conversation-composer-input"
        rows={3}
      />
      <div className="conversation-composer__actions">
        <button type="button" className="primary" data-testid="conversation-composer-send">发送</button>
      </div>
    </footer>
  )
}

function PlanToggle(): React.JSX.Element {
  return <button type="button" className="conversation-composer__plan" data-testid="conversation-composer-plan">计划模式</button>
}

function ModelSelector(): React.JSX.Element {
  return <button type="button" className="conversation-composer__model" data-testid="conversation-composer-model">选择模型</button>
}

function AttachmentDock(): React.JSX.Element {
  return <div className="conversation-composer__attachments" data-testid="conversation-composer-attachments">附件</div>
}

function InputTriggerPicker(): React.JSX.Element {
  return <div className="conversation-composer__triggers" data-testid="conversation-composer-triggers" />
}

function BrandMark(): React.JSX.Element {
  return <span className="conversation-hero__brand" data-testid="conversation-hero-brand">小薇</span>
}

function WorkspacePicker(): React.JSX.Element {
  return <div className="conversation-hero__workspace" data-testid="conversation-hero-workspace" />
}

function AgentPresetPicker(): React.JSX.Element {
  return <div className="conversation-hero__agent-preset" data-testid="conversation-hero-agent-preset" />
}
