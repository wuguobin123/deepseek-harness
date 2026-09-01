import { chromium } from '../../../../node_modules/.pnpm/playwright-core@1.62.1/node_modules/playwright-core/index.mjs'

const debugUrl = process.argv[2] ?? 'http://127.0.0.1:9222'
const prompt = '请使用 xiaowei-business-metrics 业务 Skill 查询第一页注册用户明细。必须调用 registered-user-details 操作，只返回脱敏邮箱和注册日期。'
const browser = await chromium.connectOverCDP(debugUrl)
try {
  const page = browser.contexts()[0]?.pages()[0]
  if (page === undefined) throw new Error('Xiaowei renderer page is unavailable')
  const newSession = page.locator('button[aria-label="新建会话"]').filter({ hasText: '新会话' }).first()
  await newSession.click()
  await page.waitForTimeout(1_000)
  const input = page.locator('textarea:visible').last()
  await input.fill(prompt)
  await page.locator('button[aria-label="发送消息"]:visible').last().click()
  await page.waitForFunction(expectedPrompt => {
    const text = document.body.innerText
    const start = text.lastIndexOf(expectedPrompt)
    if (start < 0) return false
    const segment = text.slice(start)
    return segment.includes('business_skill_call · registered-user-details')
      && segment.includes('***')
      && /\b\d{4}-\d{2}-\d{2}\b/.test(segment)
  }, prompt, { timeout: 180_000 })
  await page.waitForTimeout(1_500)
  const evidence = await page.evaluate(expectedPrompt => {
    const body = document.body.innerText
    const start = body.lastIndexOf(expectedPrompt)
    const segment = start < 0 ? '' : body.slice(start)
    const emailTokens = segment.match(/[^\s,，:："'<>()[\]{}]+@[^\s,，"'<>()[\]{}]+/g) ?? []
    const unmaskedEmailCount = emailTokens.filter(token => !token.includes('***')).length
    const forbiddenLabels = ['userId', 'tenantId', 'displayName', 'passwordHash', 'password_hash']
      .filter(label => segment.includes(label))
    return {
      promptFound: start >= 0,
      toolCallFound: segment.includes('business_skill_call · registered-user-details'),
      maskedEmailCount: emailTokens.filter(token => token.includes('***')).length,
      registeredDateCount: segment.match(/\b\d{4}-\d{2}-\d{2}\b/g)?.length ?? 0,
      unmaskedEmailCount,
      forbiddenLabelCount: forbiddenLabels.length,
    }
  }, prompt)
  if (!evidence.promptFound || !evidence.toolCallFound || evidence.maskedEmailCount < 1
    || evidence.registeredDateCount < 1 || evidence.unmaskedEmailCount !== 0 || evidence.forbiddenLabelCount !== 0) {
    throw new Error(`installed-client registered-user acceptance failed: ${JSON.stringify(evidence)}`)
  }
  process.stdout.write(`${JSON.stringify(evidence)}\n`)
} finally {
  await browser.close()
}
