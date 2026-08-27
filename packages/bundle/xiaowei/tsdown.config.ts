/** Bundle every public Xiaowei entry consumed by its Cordis patch. */
export default {
  entry: [
    'lib/types/index.js',
    'lib/types/invariant.js',
    'lib/types/startup.js',
    'lib/types/webserver.js',
  ],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
}
