/** Build the adapter root and dependency-free parent-process IPC entry separately. */
export default {
  entry: ['lib/types/index.js', 'lib/types/ipc.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
}
