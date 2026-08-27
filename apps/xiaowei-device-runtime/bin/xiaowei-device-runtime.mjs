#!/usr/bin/env node
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { boot, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const require = createRequire(import.meta.url)
const basePatch = resolve(root, 'cordis.base.patch.yml')
process.env.XIAOWEI_LOCAL_PRESET_ROOT ??= resolve(dirname(require.resolve('@deepseek-ai/dsh-xiaowei-local/package.json')), 'agent-presets')
const devicePatch = resolve(root, 'cordis.patch.yml')
const config = resolve(root, 'cordis.yml')
const patches = [...loadOverlayPatches('xiaowei-device-runtime', basePatch), ...loadOverlayPatches('xiaowei-device-runtime', devicePatch)]
const ctx = await boot('xiaowei-device-runtime', config, patches, undefined, pathToFileURL(resolve(root, 'package.json')).href)
const stop = async () => {
  await ctx.fiber.dispose()
  process.exitCode = 0
}
process.once('SIGINT', stop)
process.once('SIGTERM', stop)
