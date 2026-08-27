// Keyless assembled-client snapshot: the explicit remote fixture authority
// selects the account-scoped Models page, while the real settings shell,
// slots, locale, and renderer exercise create and confirmed removal.
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  assertFixtureInventory,
  captureStableAria,
  compareOrRefreshGolden,
  launchWebScaffold,
  watchConsole,
  webSnapshotMode,
  type WebScaffold,
} from './scaffold.ts'
import { ZH_BROWSER_LOCALE, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/account-custom-models', import.meta.url))
const FORM_EXPECTED = join(SNAPSHOT_DIR, 'form.expected.md')
const CONFIGURED_EXPECTED = join(SNAPSHOT_DIR, 'configured.expected.md')
const DELETE_EXPECTED = join(SNAPSHOT_DIR, 'delete.expected.md')
const MODE = webSnapshotMode()

describe('web e2e: account custom models in remote settings', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 1440, height: 960 }, locale: ZH_BROWSER_LOCALE })
    tripwire = watchConsole(page)
    await page.goto(`${scaffold.baseUrl}?fixture&fixtureRemote`, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('creates a write-only account model and removes it only after confirmation', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-account-custom-models'))
    await page.getByRole('button', { name: '设置', exact: true }).click()
    const settings = page.getByRole('dialog', { name: '设置' })
    await settings.getByRole('button', { name: '模型', exact: true }).click()
    await settings.getByText('当前账户还没有添加自定义模型。').waitFor({ timeout: 10_000 })
    await settings.getByRole('button', { name: '添加自定义模型' }).click()

    await settings.getByLabel('显示名称').fill('研发网关')
    await settings.getByLabel('API 地址').fill('https://api.example.com/v1')
    await settings.getByLabel('API 协议').selectOption('openai-responses')
    await settings.getByLabel('模型 ID').fill('research-model')
    const formSnapshot = await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(FORM_EXPECTED, formSnapshot, MODE)

    await settings.getByLabel('API 密钥').fill('sk-write-only-example')
    await settings.getByRole('button', { name: '保存', exact: true }).click()
    await settings.getByText('研发网关', { exact: true }).waitFor({ timeout: 10_000 })
    expect(await settings.locator('input[value="sk-write-only-example"]').count()).toBe(0)
    expect((await page.content()).includes('sk-write-only-example')).toBe(false)
    const configuredSnapshot = await captureStableAria(
      page,
      '[role="dialog"]',
      scaffold.workspaceCwd,
    )
    await compareOrRefreshGolden(CONFIGURED_EXPECTED, configuredSnapshot, MODE)

    await settings.getByRole('button', { name: '删除', exact: true }).click()
    const confirmation = page.getByRole('dialog', { name: '删除 研发网关？' })
    await confirmation.waitFor({ timeout: 10_000 })
    const deleteSnapshot = await captureStableAria(
      page,
      '[role="dialog"][aria-label="删除 研发网关？"]',
      scaffold.workspaceCwd,
    )
    await compareOrRefreshGolden(DELETE_EXPECTED, deleteSnapshot, MODE)
    await confirmation.getByRole('button', { name: '删除模型' }).click()
    await settings.getByText('当前账户还没有添加自定义模型。').waitFor({ timeout: 10_000 })
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('keeps the fixture inventory closed', async () => {
    await assertFixtureInventory(
      SNAPSHOT_DIR,
      ['configured.expected.md', 'delete.expected.md', 'form.expected.md'],
    )
  })
})
