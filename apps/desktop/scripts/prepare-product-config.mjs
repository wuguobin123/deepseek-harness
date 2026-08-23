import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const source = JSON.parse(
  await fs.readFile(path.join(root, 'product-config.json'), 'utf8')
);
const apiBaseUrl = process.env.WORKBENCH_API_BASE_URL || source.apiBaseUrl;
const parsed = new URL(apiBaseUrl);
if (!['http:', 'https:'].includes(parsed.protocol)) {
  throw new Error('WORKBENCH_API_BASE_URL must be an HTTP(S) URL');
}
await fs.mkdir(path.join(root, 'dist'), { recursive: true });
await fs.writeFile(
  path.join(root, 'dist', 'product-config.json'),
  `${JSON.stringify({ apiBaseUrl: parsed.toString().replace(/\/$/, '') }, null, 2)}\n`,
  'utf8'
);
