// Keyless browser snapshot for the search credential fallback. The model turn
// replays while the real DeepSeek provider reports its absent credential and
// the real SearXNG provider calls a deterministic local JSON endpoint.
import { mkdir, readFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-workspace'
import {
  fixtureUserPrompts,
  launchWebScaffold,
  watchConsole,
  webSnapshotMode,
  type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const FIXTURE = fileURLToPath(new URL('./snapshots/web-search-round/session.jsonl', import.meta.url))
const QUERIES = ['DeepSeek Harness snapshot search', 'DeepSeek Harness multi-query search'] as const
const PROMPT = `Use web_search once with queries ${JSON.stringify(QUERIES)}. Then reply exactly SEARCH_DONE and stop.`
const MODE = webSnapshotMode()

interface CapturedRequest {
  readonly query: string
  readonly format: string
}

async function startSearxngServer(captured: CapturedRequest[]): Promise<{ server: Server; baseURL: string }> {
  const server = createServer((request, response) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk: string) => { body += chunk })
    request.on('end', () => {
      const form = new URLSearchParams(body)
      const query = form.get('q') ?? ''
      captured.push({ query, format: form.get('format') ?? '' })
      const queryIndex = QUERIES.indexOf(query as typeof QUERIES[number])
      response.writeHead(queryIndex < 0 ? 400 : 200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({
        results: queryIndex < 0
          ? []
          : [{
            url: `https://search.example.test/result/${queryIndex + 1}`,
            title: `Keyless result ${queryIndex + 1}`,
            content: `SearXNG excerpt for ${query}`,
          }],
      }))
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  return { server, baseURL: `http://127.0.0.1:${(server.address() as AddressInfo).port}` }
}

describe.skipIf(MODE === 'record')('web e2e: missing DeepSeek search credential fallback', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let searchServer: Server | undefined
  let tripwire: ReturnType<typeof watchConsole>
  let previousMissingCredential: string | undefined
  const searchRequests: CapturedRequest[] = []
  const sessionEvents: SessionEvent[] = []

  beforeAll(async () => {
    previousMissingCredential = process.env.DSH_WEB_SEARCH_FALLBACK_BROWSER_E2E_MISSING
    delete process.env.DSH_WEB_SEARCH_FALLBACK_BROWSER_E2E_MISSING
    const search = await startSearxngServer(searchRequests)
    searchServer = search.server
    scaffold = await launchWebScaffold({
      deepSeekSearch: {
        baseURL: 'http://127.0.0.1:9',
        apiKeyEnv: 'DSH_WEB_SEARCH_FALLBACK_BROWSER_E2E_MISSING',
      },
      searxngSearch: { baseURL: search.baseURL },
      replayFixture: FIXTURE,
      paceMs: 15,
    })
    const workspacePath = join(scaffold.workspaceCwd, 'workspace')
    await mkdir(workspacePath, { recursive: true })
    await scaffold.ctx.workspaceRegistry.create(workspacePath)
    scaffold.ctx.on('session/event', (_session, event: SessionEvent) => { sessionEvents.push(event) })
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await page.locator('textarea:enabled').waitFor({ timeout: 15_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
    await new Promise<void>((resolve, reject) => {
      if (searchServer === undefined) {
        resolve()
        return
      }
      searchServer.close((error) => {
        if (error === undefined) resolve()
        else reject(error)
      })
    })
    if (previousMissingCredential === undefined) delete process.env.DSH_WEB_SEARCH_FALLBACK_BROWSER_E2E_MISSING
    else process.env.DSH_WEB_SEARCH_FALLBACK_BROWSER_E2E_MISSING = previousMissingCredential
  })

  it('settles with durable SearXNG sources and no DeepSeek auxiliary request', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-search-credential-fallback'))
    expect(fixtureUserPrompts(await readFile(FIXTURE, 'utf8'))).toEqual([PROMPT])
    const input = page.locator('textarea').first()
    await input.waitFor({ timeout: 10_000 })
    const settled = scaffold.whenTurnSettled()
    await input.fill(PROMPT)
    await input.press('Enter')
    await settled

    expect(searchRequests).toEqual(QUERIES.map(query => ({ query, format: 'json' })))
    expect(sessionEvents.filter(event => event.type === 'web/deepseek-search-llm-request')).toEqual([])
    const call = sessionEvents.find(
      (event): event is Extract<SessionEvent, { type: 'tool/call' }> =>
        event.type === 'tool/call' && event.data.name === 'web_search',
    )
    if (call === undefined) throw new Error('the replayed turn did not call web_search')
    const result = sessionEvents.find(
      (event): event is Extract<SessionEvent, { type: 'tool/result' }> =>
        event.type === 'tool/result' && event.data.message.source.callId === call.data.callId,
    )
    if (result === undefined) throw new Error('web_search produced no durable result')
    const content = result.data.message.content[0]
    expect(content.isError).toBe(false)
    const rendered = content.content.filter(block => block.type === 'text').map(block => block.text).join('')
    expect(rendered).toMatchInlineSnapshot(`
      "Sources:
      - [Keyless result 1](https://search.example.test/result/1) — SearXNG excerpt for DeepSeek Harness snapshot search
      - [Keyless result 2](https://search.example.test/result/2) — SearXNG excerpt for DeepSeek Harness multi-query search

      Cite the relevant URLs above as markdown links in your answer."
    `)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 200_000)
})
