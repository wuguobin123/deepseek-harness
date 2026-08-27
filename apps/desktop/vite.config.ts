import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../..');

/**
 * Rewrite `@deepseek-ai/dsh-<group>-<name>/client` subpath imports to the
 * owning package's TypeScript source entry. The published `lib/client.js`
 * artifacts are `window.__ModuleLoader__.load(...)` factories for the served
 * web runtime, not static ESM, so the desktop bundle compiles the sources
 * directly. Subpaths whose package has no `src/client/index.ts` (e.g.
 * `dsh-host-apiproxy/client`, a lib ESM output) fall through to normal
 * package resolution.
 */
function clientSourceRewrite(): Plugin {
  const pattern = /^@deepseek-ai\/dsh-(client|host|api)-(.+)\/client$/;
  return {
    name: 'dsh-client-source-rewrite',
    enforce: 'pre',
    resolveId(id) {
      const match = pattern.exec(id);
      if (!match) return null;
      const candidate = resolve(repoRoot, 'packages', match[1], match[2], 'src/client/index.ts');
      return existsSync(candidate) ? candidate : null;
    }
  };
}

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  base: './',
  define: {
    'process.env.DSH_CLIENT_TITLE': JSON.stringify('小薇')
  },
  publicDir: resolve(__dirname, 'src/renderer/public'),
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@renderer': resolve(__dirname, 'src/renderer')
    }
  },
  plugins: [clientSourceRewrite(), react()],
  build: {
    outDir: resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true,
    target: 'chrome120',
    sourcemap: true,
    rollupOptions: {
      input: resolve(__dirname, 'src/renderer/index.html')
    }
  },
  server: {
    port: 5173,
    strictPort: true
  }
});
