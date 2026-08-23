import type { FixSuggestion } from '../../shared/contracts';

interface Props {
  suggestions: FixSuggestion[];
  onAction?: (action: string, payload: Record<string, unknown>) => void;
}

/**
 * One-click recovery actions surfaced when a capability fails with a
 * recoverable error (rate_limited / auth_error / timeout / ...).
 *
 * Sorted by priority ascending (priority 1 renders first). Clicking a button
 * invokes ``onAction(action, payload)``; if no handler is provided, a built-in
 * router handles common cases (toast feedback, settings-page deep links).
 */
export function FixSuggestionButtons({ suggestions, onAction }: Props): JSX.Element | null {
  if (!suggestions || suggestions.length === 0) {
    return null;
  }
  const ordered = [...suggestions].sort((a, b) => a.priority - b.priority);

  function handleClick(suggestion: FixSuggestion): void {
    if (onAction) {
      onAction(suggestion.action, suggestion.payload);
      return;
    }
    defaultActionRouter(suggestion);
  }

  return (
    <div className="fix-suggestions" role="group" aria-label="修复建议">
      {ordered.map((suggestion, index) => (
        <button
          key={`${suggestion.action}-${index}`}
          type="button"
          className="btn btn--ghost btn--small"
          onClick={() => handleClick(suggestion)}
          title={suggestion.description ?? suggestion.title}
          data-testid={`fix-suggestion-${suggestion.action}`}
        >
          {suggestion.title}
        </button>
      ))}
    </div>
  );
}

/**
 * Built-in router for the most common fix_suggestions actions. Apps that
 * want richer behavior (e.g. resend the last assistant message) should pass
 * an explicit ``onAction`` handler instead.
 */
function defaultActionRouter(suggestion: FixSuggestion): void {
  switch (suggestion.action) {
    case 'retry':
    case 'wait':
      // Show a brief toast acknowledging the wait/retry instruction.
      window.dispatchEvent(
        new CustomEvent('workbench:fix-suggestion-toast', {
          detail: { action: suggestion.action, title: suggestion.title }
        })
      );
      return;
    case 'update_api_key':
    case 'upgrade_plan':
    case 'contact_admin':
      // Deep-link into the settings page; the renderer owns navigation.
      window.dispatchEvent(
        new CustomEvent('workbench:fix-suggestion-navigate', {
          detail: { action: suggestion.action, payload: suggestion.payload }
        })
      );
      return;
    default:
      window.dispatchEvent(
        new CustomEvent('workbench:fix-suggestion-unhandled', {
          detail: { action: suggestion.action, payload: suggestion.payload }
        })
      );
  }
}