import { defineConfig } from 'tsdown'
export default defineConfig({ entry: ['src/index.ts', 'src/server.ts'], dts: false, platform: 'node', format: ['esm'], outDir: 'lib', outExtensions: () => ({ js: '.js' }) })
