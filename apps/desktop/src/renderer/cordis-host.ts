/**
 * Renderer-side Cordis host.
 *
 * Mirrors `packages/client/web/src/boot.ts` `AppWebEntry.run` choreography:
 *  1. Install `__DSH_TRANSPORT__` so the connection plugin picks up the
 *     IPC adapter instead of building a Web fetch / WebSocket client.
 *  2. Light-theme pre-paint (sets `data-ds-dark-theme` before React).
 *  3. Build a fresh `cordis.Context`.
 *  4. Activate plugins in dependency order:
 *     connection → typert → runtime → settings (provides settingsScope) →
 *     locale → theme → foundation chrome (layout/sidebar/workspace/brand) →
 *     conversation surface (conversation/tool/user-questions/...) →
 *     orchestrator (plan/goal/jobs/subagent/...) →
 *     settings sections (general/models/plugins/...) →
 *     renderer (last — needs every other plugin registered).
 *
 * The runtime requires `connection`, `typert`, `remote`, and
 * `remote.commands`; the layout requires `slots` and `theme`. The host
 * therefore activates the prerequisite services before any feature.
 *
 * The renderer `mount(container)` happens via `ctx.uiRenderer.mount`,
 * which renders the slot-based root tree assembled by `ui-layout`'s
 * `AppFrame` registration.
 */
import { Context, type Events } from '@deepseek-ai/cordis'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { TypertRegistry } from '@deepseek-ai/dsh-typert-registry'
import { apply as connectionApply } from '@deepseek-ai/dsh-client-connection/client'
import { apply as apiGatewayApply } from '@deepseek-ai/dsh-api-gateway/client'
import { apply as apiRemotesApply } from '@deepseek-ai/dsh-api-remotes/client'
import { apply as runtimeApply } from '@deepseek-ai/dsh-client-runtime/client'
import { apply as localeApply } from '@deepseek-ai/dsh-client-locale/client'
import { apply as themeApply } from '@deepseek-ai/dsh-client-ui-theme/client'
import { apply as rendererApply } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { apply as layoutApply } from '@deepseek-ai/dsh-client-ui-layout/client'
import { apply as sidebarApply } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { apply as workspaceApply } from '@deepseek-ai/dsh-client-ui-workspace/client'
import { apply as conversationApply } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { apply as toolApply } from '@deepseek-ai/dsh-client-ui-tool/client'
import { apply as userQuestionsApply } from '@deepseek-ai/dsh-client-ui-user-questions/client'
import { apply as attachmentApply } from '@deepseek-ai/dsh-client-ui-attachment/client'
import { apply as messageFeedbackApply } from '@deepseek-ai/dsh-client-ui-message-feedback/client'
import { apply as deliverablesApply } from '@deepseek-ai/dsh-client-ui-deliverables/client'
import { apply as skillApply } from '@deepseek-ai/dsh-client-ui-skill/client'
import { apply as inputTriggerApply } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { apply as commandsApply } from '@deepseek-ai/dsh-client-ui-commands/client'
import { apply as referenceApply } from '@deepseek-ai/dsh-client-ui-reference/client'
import { apply as planApply } from '@deepseek-ai/dsh-client-ui-plan/client'
import { apply as goalApply } from '@deepseek-ai/dsh-client-ui-goal/client'
import { apply as trajectoryApply } from '@deepseek-ai/dsh-client-ui-trajectory/client'
import { apply as jobsApply } from '@deepseek-ai/dsh-client-ui-jobs/client'
import { apply as subagentApply } from '@deepseek-ai/dsh-client-ui-subagent/client'
import { apply as workflowRunApply } from '@deepseek-ai/dsh-client-ui-workflow-run/client'
import { apply as agentPresetApply } from '@deepseek-ai/dsh-client-ui-agent-preset/client'
import { apply as settingsApply } from '@deepseek-ai/dsh-client-ui-settings/client'
import { apply as settingsGeneralApply } from '@deepseek-ai/dsh-client-ui-settings-general/client'
import { apply as settingsModelsApply } from '@deepseek-ai/dsh-client-ui-settings-models/client'
import { apply as settingsPluginsApply } from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import { apply as settingsPluginInventoryApply } from '@deepseek-ai/dsh-client-ui-settings-plugin-inventory/client'
import { apply as modelSelectionApply } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import { apply as permissionPresetsApply } from '@deepseek-ai/dsh-client-ui-permission-presets/client'
import { apply as dirPickerNativeApply } from '@deepseek-ai/dsh-client-ui-directory-picker-native/client'
import { apply as directoryImportApply } from './directory-import-flow'

import { installPersistedTheme } from './theme-persist'
import { resolveDirectoryFlowSurface } from './directory-flow'
import { apply as htmlPreviewToolviewApply } from './features/html-preview/html-preview-toolview'
import { apply as docPreviewToolviewApply } from './features/doc-preview/doc-preview-toolview'
import { apply as chartPreviewToolviewApply } from './features/chart-preview/chart-preview-toolview'
import { apply as artifactDetailsApply } from './features/document-preview/artifact-details'
import { apply as xiaoweiBrandApply } from './features/brand/XiaoweiBrand'
import { apply as accountChromeApply } from './features/auth/UserMenu'
import { installTransport, type WorkbenchApiTransport } from './transport'

/** Bundle of disposers returned to the boot caller. */
export interface HostHandles {
  ctx: Context
  dispose: () => Promise<void>
}

/**
 * Drain every pending fiber so the next `apply` reads fully-constructed
 * services.
 *
 * Cordis `ctx.plugin(SomeService)` returns a wrapper whose underlying
 * fiber runs `_reload()` async: the actual `new SomeService(ctx)` lands
 * one microtask after `apply()` returns (see
 * `vendor/cordis/src/fiber.ts:646-673`). WebUI gets away with this because
 * its loader fires `loader.await()` after the whole batch; the desktop
 * shell activates plugins one-by-one, so each `apply()` would otherwise
 * see predecessor services still in their fiber's PENDING state.
 * Walking the registry and awaiting every fiber's inertia collapses the
 * pending queue before the next plugin reads.
 */
async function drainFibers(ctx: Context): Promise<void> {
  const registry = (ctx as unknown as {
    registry: { values: () => Iterable<{ fibers: Array<{ inertia: Promise<void> | undefined }> }> }
  }).registry
  const pending: Array<Promise<void>> = []
  for (const runtime of registry.values()) {
    for (const fiber of runtime.fibers) {
      if (fiber.inertia !== undefined) pending.push(fiber.inertia)
    }
  }
  await Promise.all(pending)
}

/**
 * Activate the full Cordis plugin graph and mount the React tree.
 *
 * Activation is sequential, in dependency order — each `await` ensures
 * the previous plugin's `ctx.provide(...)` and `ctx.slots.register(...)`
 * calls have settled before the next plugin reads them through its
 * `inject` face. `activate()` also drains pending fibers so Service
 * classes registered via `ctx.plugin(SomeService)` (whose constructors
 * run on the next microtask) are visible to the following plugin.
 *
 * @param container - root HTML element the React tree mounts into.
 * @param api       - IPC bridge (`window.workbenchApi`).
 * @param baseUrl   - configured dsh host base URL; decides the directory-flow
 *                    surface (loopback → native OS chooser, remote → browse).
 * @returns host handles with `ctx` and a `dispose()` async disposer.
 */
export async function bootRenderer(
  container: HTMLElement,
  api: WorkbenchApiTransport,
  baseUrl: string,
  environment?: 'local' | 'cloud',
): Promise<HostHandles> {
  // 1. Theme pre-paint — set the light-mode attribute before React mounts so
  //    the first paint matches the fixed product theme.
  installPersistedTheme()

  // 2. Install the IPC transport adapter. The connection plugin's
  //    `apply()` reads `__DSH_TRANSPORT__` at boot time, so this must
  //    happen before we activate the connection plugin.
  installTransport(api, environment === undefined ? resolveDirectoryFlowSurface(baseUrl) === 'native' : environment === 'local')

  // 3. Build the Cordis Context.
  const ctx = new Context()

  // Helper: run an apply, then drain every pending fiber so the next
  // apply reads fully-constructed services. Each apply function ends in
  // `ctx.plugin(SomeService)` (or equivalent) which queues the Service
  // constructor on a microtask; without the drain, the next plugin would
  // see predecessor services still in their fiber's PENDING state.
  const activate = async (apply: (ctx: ClientContext) => unknown): Promise<void> => {
    await apply(ctx)
    await drainFibers(ctx)
  }

  // 4. Typert — the Client reflection registry. Provides `ctx.typert`,
  //    which the runtime plugin reads to register Client Context binders
  //    (`ctx.typert.contexts.registerClient('agent', ...)`). Must precede
  //    the runtime plugin; has no other dependencies. Uses the named
  //    class export because the `./client` subpath ships a ModuleLoader
  //    bundle that Rollup cannot statically analyze.
  ;(ctx as unknown as { plugin: (s: unknown) => unknown }).plugin(TypertRegistry)
  await drainFibers(ctx)

  // 5. Foundation: connection — provides `ctx.connection` (the
  //    `ConnectionHandle` with `api`, `start()`, `rpc`, etc.) and the
  //    `ctx.remote` event bus via its service base.
  await activate(connectionApply)

  // 6. API gateway — provides `ctx.remote` (the TypertClientRemote service
  //    the runtime plugin reads to forward host/remote-event frames into
  //    the `ctx.remote` event bus). Must run after typert (its register
  //    uses `ctx.typert.contexts`) and after connection (it consumes the
  //    wire client), but before runtime.
  await activate(apiGatewayApply)

  // 6b. API remotes — mounts every Remote namespace the Client assembly
  //    selects (commands / goals / file-reference / message-feedback /
  //    plugin-inventory / session-reference / cordis-host-runner). Each
  //    namespace registers as `remote.<namespace>` on the context, and
  //    Services that statically declare them (e.g. ui-commands'
  //    `inject = ['remote.commands']`) stay PENDING until this step
  //    completes. Must run after api-gateway (it consumes `ctx.remote`)
  //    and before runtime.
  await activate(apiRemotesApply)

  // 7. Foundation: runtime — provides `ctx.slots`, `ctx.sessions`,
  //    `ctx.workspaces`, `ctx.conversationEvents`, `ctx.conversationViews`.
  //    The runtime also wires up the connection stream loop (consumes
  //    `ctx.connection.start()`) and bridges host envelopes into the
  //    `ctx.remote` event bus.
  await activate(runtimeApply)

  // 8. Settings domain — provides `ctx.settingsScope`, the
  //    `SettingsScopeBinder` used by the remaining configurable preferences.
  await activate(settingsApply)

  // 9. Locale + theme — fixed Chinese and light product defaults. Locale
  //    precedes the UI plugins whose dictionaries attach to its registry.
  await activate(localeApply)
  await activate(themeApply)

  // 10. Foundation chrome — `AppFrame` (the slot-based root), sidebar,
  //    workspace browser, brand mark. Each registers into a slot the
  //    next plugin reads; sequential activation keeps the slot graph
  //    consistent.
  await activate(layoutApply)
  await activate(sidebarApply)
  await activate(workspaceApply)
  await activate(xiaoweiBrandApply)

  // 10. Conversation surface — input triggers run first because skill /
  //     reference / commands each consume `ctx.inputTriggers`.
  await activate(inputTriggerApply)
  await activate(conversationApply)
  await activate(toolApply)
  await activate(userQuestionsApply)
  await activate(attachmentApply)
  await activate(messageFeedbackApply)
  await activate(deliverablesApply)
  await activate(skillApply)

  // 10a. Xiaowei artifact toolviews — register keyed entries under
  //      `tool.call.toolview` for the html_build / slides_build /
  //      doc_build / sheet_build tools. Each entry is a function plugin;
  //      the slot registry already declared `tool.call.toolview` as a
  //      child slot in `ui-tool`'s apply.
  await activate(htmlPreviewToolviewApply)
  await activate(docPreviewToolviewApply)
  await activate(chartPreviewToolviewApply)
  await activate(artifactDetailsApply)

  // 11. Inputs and commands — `inputTriggers` is already mounted by step 10;
  //     commands and reference register sources into the trigger registry.
  await activate(commandsApply)
  await activate(referenceApply)

  // 12. Orchestrator and plan.
  await activate(planApply)
  await activate(goalApply)
  await activate(trajectoryApply)
  await activate(jobsApply)
  await activate(subagentApply)
  await activate(workflowRunApply)
  await activate(agentPresetApply)

  // 13. Settings sections — `settingsApply` (the binder) already ran in
  //     step 7 above; these are the per-section registrants that declare
  //     the actual settings UI tree.
  await activate(settingsGeneralApply)
  await activate(accountChromeApply)
  await activate(settingsModelsApply)
  await activate(settingsPluginsApply)
  await activate(settingsPluginInventoryApply)
  await activate(modelSelectionApply)
  await activate(permissionPresetsApply)

  // 14. Directory-flow surface — explicit desktop environments always use
  //    Electron's native chooser. Main then either attaches the selected real
  //    path to the local runtime or uploads a bounded copy to the cloud Host.
  //    Legacy session documents without an environment retain the baseUrl
  //    fallback while they are migrated on the next settings write.
  await activate(
    environment === undefined
      ? (resolveDirectoryFlowSurface(baseUrl) === 'native' ? dirPickerNativeApply : directoryImportApply)
      : directoryImportApply,
  )

  // 15. Renderer — last; provides `ctx.uiRenderer` which renders the
  //    root slot into the container.
  await activate(rendererApply)

  // 16. Mount.
  const uiRenderer = (ctx as unknown as { uiRenderer?: { mount: (c: HTMLElement) => () => void } }).uiRenderer
  if (!uiRenderer) {
    throw new Error('desktop renderer boot: ctx.uiRenderer missing — renderer plugin did not provide it')
  }
  const unmount = uiRenderer.mount(container)

  return {
    ctx,
    dispose: () => {
      // Unmount React. Cordis Context has no public dispose — the
      // fiber graph is torn down when the host process exits.
      try {
        unmount()
      } catch (error) {
        console.error('[desktop-cordis] unmount threw during dispose:', error)
      }
      return Promise.resolve()
    },
  }
}

/** Re-export the slot renderer for downstream consumers. */
export type { Events }
