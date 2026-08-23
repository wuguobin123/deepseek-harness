// 用 standalone 启动形态（真实 keychain 密钥）把明文凭证重新加密写回 credentials.bin，
// 恢复用户正常启动客户端时的可解密性。用法：electron _encrypt-creds.cjs <明文JSON文件>
const { app, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

app.setName('@enterprise-workbench/desktop');
app.whenReady().then(() => {
  try {
    const input = process.argv[2];
    if (!input) throw new Error('missing input path');
    const plain = fs.readFileSync(input, 'utf8');
    JSON.parse(plain); // 校验是合法 JSON
    const target = path.join(app.getPath('userData'), 'credentials.bin');
    fs.writeFileSync(target, safeStorage.encryptString(plain), { mode: 0o600 });
    console.log('OK');
  } catch (err) {
    console.error('ENCRYPT_FAILED', String(err));
    process.exitCode = 1;
  } finally {
    app.quit();
  }
});
