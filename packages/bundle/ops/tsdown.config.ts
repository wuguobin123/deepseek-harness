import { defineConfig } from 'tsdown'

/**
 * The root tsdown only bundles `lib/types/{index,invariant,startup}.js`;
 * bundle/ops also ships the `./webserver` subpath entry consumed by
 * `cordis.patch.yml`. Override here so `pnpm -w run build:lib:host` emits
 * `lib/webserver.js` alongside the others. Declarations come from `tsc -b`
 * (dts: false), matching every package.
 */
export default defineConfig({
  entry: ['lib/types/index.js', 'lib/types/invariant.js', 'lib/types/startup.js', 'lib/types/webserver.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
})