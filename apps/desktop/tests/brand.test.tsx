import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  XiaoweiBrandMark,
  XiaoweiBrandName,
} from '../src/renderer/features/brand/XiaoweiBrand'

describe('Xiaowei desktop brand', () => {
  it('renders the product title independently from the mark', () => {
    expect(renderToStaticMarkup(<XiaoweiBrandName />)).toContain('小薇')
  })

  it('honors the host-requested mark size', () => {
    const markup = renderToStaticMarkup(<XiaoweiBrandMark size={24} className="brand-mark" />)
    expect(markup).toContain('width="24"')
    expect(markup).toContain('height="24"')
    expect(markup).toContain('class="brand-mark"')
  })

  it('uses the Xiaowei identity for packaged applications', () => {
    const config = readFileSync(new URL('../electron-builder.yml', import.meta.url), 'utf8')
    expect(config).toMatch(/^productName: 小薇$/m)
    expect(config).toMatch(/^icon: src\/renderer\/features\/brand\/xiaowei-logo\.png$/m)
  })
})
