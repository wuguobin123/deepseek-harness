/** Copy dictionaries for the business skills Settings section. */
/** Simplified Chinese copy. */
export const zh = {
  tab: '业务 Skill', loading: '正在读取业务 Skill…', error: '暂时无法读取业务 Skill。', retry: '重试',
  empty: '暂无业务 Skill。', skillId: 'Skill ID', title: '名称', activeVersion: '当前版本', revision: '修订号', enabled: '状态',
  enabledTag: '已启用', disabledTag: '已停用', manifest: 'Skill 清单（YAML 或 JSON）', validate: '校验清单', publish: '发布版本', disable: '停用',
  rollback: '回滚版本', targetVersion: '目标版本', validating: '校验中…', publishing: '发布中…', saving: '处理中…', valid: '清单校验通过。',
  invalid: '清单未通过校验。', published: '已发布，列表已更新。', disabledNotice: '已停用，列表已更新。', rolledBack: '已回滚，列表已更新。',
  operationError: '操作失败，请检查清单或刷新后重试。', noIssues: '没有发现问题。', issues: '问题',
} satisfies Record<string, string>
/** Locale keys shared by every business Skill dictionary. */
export type BusinessSkillsLocaleKey = keyof typeof zh
/** English copy. */
export const en = {
  tab: 'Business Skills', loading: 'Reading business skills…', error: 'Business skills are temporarily unavailable.', retry: 'Retry',
  empty: 'No business skills.', skillId: 'Skill ID', title: 'Title', activeVersion: 'Active version', revision: 'Revision', enabled: 'Status',
  enabledTag: 'Enabled', disabledTag: 'Disabled', manifest: 'Skill manifest (YAML or JSON)', validate: 'Validate manifest', publish: 'Publish version', disable: 'Disable',
  rollback: 'Roll back version', targetVersion: 'Target version', validating: 'Validating…', publishing: 'Publishing…', saving: 'Working…', valid: 'Manifest is valid.',
  invalid: 'Manifest has validation issues.', published: 'Published. The list was refreshed.', disabledNotice: 'Disabled. The list was refreshed.', rolledBack: 'Rolled back. The list was refreshed.',
  operationError: 'The operation failed. Check the manifest or refresh and try again.', noIssues: 'No issues found.', issues: 'Issues',
} satisfies Record<BusinessSkillsLocaleKey, string>
