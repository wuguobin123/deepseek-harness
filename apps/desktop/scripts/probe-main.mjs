// 用 playwright 启动形态解密当前 credentials.bin，输出明文 JSON 到指定文件（0600）
import { _electron as electron } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';

const out = process.argv[2];
const app = await electron.launch({ args: ['.'], cwd: path.resolve(import.meta.dirname, '..') });
try {
  const res = await app.evaluate(({ app, safeStorage }) => {
    const fs = process.getBuiltinModule('node:fs');
    const path = process.getBuiltinModule('node:path');
    const file = path.join(app.getPath('userData'), 'credentials.bin');
    try {
      return { ok: true, plain: safeStorage.decryptString(fs.readFileSync(file)) };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });
  if (!res.ok) { console.log('DECRYPT_FAILED', res.error); process.exit(1); }
  fs.writeFileSync(out, res.plain, { mode: 0o600 });
  const meta = JSON.parse(res.plain);
  console.log('OK', JSON.stringify({ tenantId: meta.tenantId, actorId: meta.actorId, baseUrl: meta.baseUrl, keyLen: (meta.apiKey || '').length }));
} finally {
  await app.close();
}
