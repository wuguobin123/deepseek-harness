# @deepseek-ai/dsh-max-token-continuation

English | [中文](README.zh.md)

This guard turns a provider output-token ceiling into bounded automatic continuation. When the latest model step ends with `max-tokens` and no caller is already queued for the next turn, it appends one source-attributed internal prompt telling the model to continue from the cutoff, skip repeated planning, and execute the next required tool. A clean completion resets the chain. Direct human input also resets it. The chain is rebuilt from session events and the durable inbox projection, so restart and replay preserve its ordinal.

The guard never changes the model's output cap, replays a truncated tool call, or marks a capped turn as successful. Each capped turn retains `turn/end.reason.kind = max-tokens`; the automatically queued turn is a separate, ordinary turn whose result remains auditable in the session log.

## Config

```yaml
- id: max-token-continuation
  name: '@deepseek-ai/dsh-max-token-continuation'
  config:
    maxContinuations: 8
```

`maxContinuations` is a required positive-integer limit after schema defaults. It bounds consecutive automatic turns for one uninterrupted task. At the limit, the agent becomes idle and the user can inspect the partial result or send a new prompt. A queued caller message always wins; the guard does not append an automatic prompt behind it.

## Model Experience

### Automatic continuation context

#### What the model sees

The message source retains `{ kind: 'plugin', plugin: 'max-token-continuation', form: 'notice', cause: 'max-tokens', fromTurn, ordinal, limit }`. The collapsed notice reports the current continuation count and configured limit. `fromTurn` makes scheduling idempotent: a queued or recorded continuation for the same capped turn is never duplicated.

##### Exact continuation prompt

```markdown
Continue the unfinished task from the exact point where the previous response was cut off. Do not restart, repeat the plan, or merely announce what you will do. For large HTML, documents, spreadsheets, tables, or code, prioritize completing and saving the artifact with html_build, doc_build, sheet_build, write, or edit; for a short chat request, close with a concise answer. Use the next required tool immediately when work remains, preserve completed work, and finish only after the task is actually complete.
```

#### Token effect

The fixed prompt is added only after a capped turn and becomes retained history. It does not alter the provider's request limit.

#### KV Cache effect

Append-only. The continuation follows the reusable request prefix and does not invalidate earlier cache entries.

## Known Limitations and Deferred Work

- Only the latest `assistant/chunk` finish with `reason.kind = max-tokens` can trigger continuation; a truncated tool call is never replayed.
- The guard cannot recover an unfinished tool call dropped by the model adapter; the next model turn must issue a complete new call.
- Repeated provider truncation still consumes tokens until completion or `maxContinuations` is reached.
