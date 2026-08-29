/**
 * Tool names whose model-facing contracts must remain identical between the
 * shipped local and account-backed Xiaowei presets.
 */
export const XIAOWEI_SHARED_TOOL_CAPABILITIES = [
  'ask_user_question',
  'create_goal',
  'edit',
  'exit_plan_mode',
  'get_goal',
  'glob',
  'grep',
  'read',
  'read_image',
  'skill',
  'skill_install',
  'todo_write',
  'update_goal',
  'web_search',
  'write',
] as const

/**
 * Shared tools whose descriptions disclose location-specific data ownership
 * while their names and parameter schemas remain identical.
 */
export const XIAOWEI_LOCATION_AWARE_TOOL_DESCRIPTIONS = [
  'skill_install',
] as const

/**
 * Tool names intentionally exposed only by the device-owned Xiaowei runtime.
 */
export const XIAOWEI_LOCAL_ONLY_TOOL_CAPABILITIES = [
  'bash',
  'interrupt_agent',
  'job_kill',
  'job_list',
  'job_output',
  'list_agents',
  'pwsh',
  'ralph',
  'send_message',
  'str_replace_editor',
  'subagent',
  'subagent_fork',
  'workflow',
] as const

/**
 * Tool names intentionally exposed only by the account-owned Xiaowei runtime.
 */
export const XIAOWEI_CLOUD_ONLY_TOOL_CAPABILITIES = [
  'document_read',
  'doc_build',
  'html_build',
  'mermaid_build',
  'sheet_analyze',
  'sheet_build',
  'slides_build',
  'svg_build',
  'web_fetch',
] as const
