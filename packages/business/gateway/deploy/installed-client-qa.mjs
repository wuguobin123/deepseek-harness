import { chromium } from '../../../../node_modules/.pnpm/playwright-core@1.62.1/node_modules/playwright-core/index.mjs'

const debugUrl = process.argv[2] ?? 'http://127.0.0.1:9222'
const prompt = '请使用 xiaowei-business-metrics 业务 Skill 查询：我的分享码还有多少个未使用？必须调用 share-code-unused 操作，只返回数量和统计时间。'
const browser = await chromium.connectOverCDP(debugUrl)
try {
  const page = browser.contexts()[0]?.pages()[0]
  if (page === undefined) throw new Error('Xiaowei renderer page is unavailable')
  const currentText = await page.locator('body').innerText()
  if (!currentText.includes(prompt) || !currentText.includes('business_skill_call · share-code-unused')) {
    const newSession = page.locator('button[aria-label="新建会话"]').filter({ hasText: '新会话' }).first()
    await newSession.click()
    await page.waitForTimeout(1_000)
    const input = page.locator('textarea:visible').last()
    await input.fill(prompt)
    const submit = page.locator('button[aria-label="发送消息"]:visible').last()
    await submit.click()
  }
  await page.waitForFunction(expectedPrompt => {
    const text = document.body.innerText
    return text.includes(expectedPrompt) && text.includes('business_skill_call · share-code-unused') && text.includes('未使用分享码数量：0') && text.includes('统计时间：')
  }, prompt, { timeout: 180_000 })
  await page.waitForTimeout(1_000)
  const evidence = await page.evaluate(expectedPrompt => {
    const bodyText = document.body.innerText
    const promptIndex = bodyText.lastIndexOf(expectedPrompt)
    const disclosures = [...document.querySelectorAll('[data-disclosure-row="true"]')]
    return {
      promptFound: promptIndex >= 0,
      transcript: (promptIndex >= 0 ? bodyText.slice(promptIndex) : bodyText.slice(-2_000)).slice(0, 4_000),
      disclosures: disclosures.slice(-10).map(row => row.textContent?.trim().slice(0, 500) ?? ''),
    }
  }, prompt)
  const serialized = JSON.stringify(evidence)
  if (!evidence.promptFound || !serialized.includes('share-code-unused') || !serialized.includes('0')) {
    throw new Error(`installed-client business Skill acceptance failed: ${serialized}`)
  }
  process.stdout.write(`${serialized}\n`)
} finally {
  await browser.close()
}
