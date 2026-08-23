import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const mainOutputDirectory = path.resolve(scriptDirectory, '../dist/main');

await mkdir(mainOutputDirectory, { recursive: true });
await writeFile(
  path.join(mainOutputDirectory, 'package.json'),
  `${JSON.stringify({ type: 'commonjs' }, null, 2)}\n`,
  'utf8'
);
