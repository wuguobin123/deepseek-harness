// 解密本机客户端凭证的辅助进程（必须以 standalone 方式直接由 shell 启动，
// 不能以 playwright 注入方式启动，否则 safeStorage 会读到不同的 keychain 项）。
// 用法：electron _decrypt-creds.cjs <输出文件>（输出为 0600 权限的 JSON）
const { app, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

app.setName('@enterprise-workbench/desktop');
app.whenReady().then(() => {
  try {
    const out = process.argv[2];
    if (!out) throw new Error('missing output path');
    const file = path.join(app.getPath('userData'), 'credentials.bin');
    const plain = safeStorage.decryptString(fs.readFileSync(file));
    fs.writeFileSync(out, plain, { mode: 0o600 });
    console.log('OK');
  } catch (err) {
    console.error('DECRYPT_FAILED', String(err));
    process.exitCode = 1;
  } finally {
    app.quit();
  }
});
