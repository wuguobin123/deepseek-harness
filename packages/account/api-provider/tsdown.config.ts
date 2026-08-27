import { defineConfig } from 'tsdown'

/** Bundle the cloud provider's runtime entry for workspace consumers. */
export default defineConfig({ entry: ['lib/types/index.js'], outDir: 'lib', format: ['esm'], platform: 'node', target: 'es2024', fixedExtension: false, dts: false, clean: false })
