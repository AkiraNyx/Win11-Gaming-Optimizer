import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
const { _electron } = await import(process.env.PLAYWRIGHT_MODULE_PATH ? pathToFileURL(path.join(process.env.PLAYWRIGHT_MODULE_PATH, 'index.mjs')).href : 'playwright');
const ui = fileURLToPath(new URL('../', import.meta.url));
const packageVersion = JSON.parse(fs.readFileSync(path.join(ui, 'package.json'), 'utf8')).version;
const artifacts = path.resolve(ui, '../work/arinox-ui-fixes/native-check');
fs.mkdirSync(artifacts, { recursive: true });
const profile = fs.mkdtempSync(path.join(artifacts, 'profile-'));
fs.writeFileSync(path.join(profile, 'arinox-ui-theme.json'), JSON.stringify({ theme: 'night' }));
const errors = [], resources = [], servers = [];
function server() {
  const out = path.join(ui, 'out');
  const instance = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname.startsWith('/api/')) {
      const data = pathname === '/api/runtime' ? { state: 'ready', mutationsEnabled: false, packageVersion }
        : pathname === '/api/hardware' ? { hasSSD: false, hasHDD: false, ramGB: 0, cpuCores: 0 }
        : pathname === '/api/restore/availability' ? { available: false } : {};
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); return;
    }
    const target = path.resolve(out, '.' + decodeURIComponent(pathname === '/' ? '/index.html' : pathname));
    if (!target.startsWith(out + path.sep) || !fs.existsSync(target) || !fs.statSync(target).isFile()) { res.writeHead(404).end(); return; }
    const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
    res.writeHead(200, { 'Content-Type': mime[path.extname(target)] || 'application/octet-stream' }); fs.createReadStream(target).pipe(res);
  });
  servers.push(instance); return instance;
}
let app;
try {
  assert.ok(process.env.ELECTRON_EXECUTABLE_PATH, 'Set ELECTRON_EXECUTABLE_PATH to an existing Electron runtime');
  app = await _electron.launch({ executablePath: process.env.ELECTRON_EXECUTABLE_PATH,
    args: [path.join(ui, 'checks/fixtures/electron-ui-app.cjs')], env: { ...process.env, WIN11OPT_UI_TEST_PROFILE: profile } });
  const page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('requestfailed', request => resources.push(request.url()));
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'night');
  await page.evaluate(() => document.fonts.ready);
  const startup = await page.evaluate(() => ({ background: getComputedStyle(document.body).backgroundColor,
    bodyFont: getComputedStyle(document.body).fontFamily, headingFont: getComputedStyle(document.querySelector('h1')).fontFamily,
    controlRadius: getComputedStyle(document.querySelector('#exit')).borderRadius }));
  assert.equal(startup.background, 'rgb(7, 10, 18)');
  assert.match(startup.bodyFont, /Inter/); assert.match(startup.headingFont, /Newsreader/); assert.equal(startup.controlRadius, '11px');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('win11optimizer:startup-state', { kind: 'error', label: '应用未能启动', detail: '隔离测试失败信息' }));
  await page.getByText('隔离测试失败信息', { exact: true }).waitFor();
  assert.equal(await page.locator('#exit').evaluate(node => node === document.activeElement), true);
  await page.screenshot({ path: path.join(artifacts, 'startup-error-night.png') });
  const first = server(), second = server();
  for (const instance of [first, second]) await new Promise(resolve => instance.listen(0, '127.0.0.1', resolve));
  await app.evaluate(async (_electron, url) => globalThis.loadPreview(url), `http://127.0.0.1:${first.address().port}/`);
  await page.waitForFunction(() => document.querySelector('.optimizer-theme')?.dataset.theme === 'night');
  await page.getByRole('button', { name: '切换日间主题' }).click();
  await page.waitForFunction(() => document.querySelector('.optimizer-theme')?.dataset.theme === 'day');
  await page.waitForFunction(() => window.win11Optimizer.getTheme() === 'day');
  assert.equal(JSON.parse(fs.readFileSync(path.join(profile, 'arinox-ui-theme.json'))).theme, 'day');
  await app.evaluate(async (_electron, url) => globalThis.loadPreview(url), `http://127.0.0.1:${second.address().port}/`);
  await page.waitForFunction(() => document.querySelector('.optimizer-theme')?.dataset.theme === 'day');
  assert.equal(await page.evaluate(() => localStorage.getItem('win11-optimizer-theme')), null);
  await app.close(); app = null;
  app = await _electron.launch({ executablePath: process.env.ELECTRON_EXECUTABLE_PATH, args: [path.join(ui, 'checks/fixtures/electron-ui-app.cjs')], env: { ...process.env, WIN11OPT_UI_TEST_PROFILE: profile } });
  const restarted = await app.firstWindow();
  await restarted.waitForFunction(() => document.documentElement.dataset.theme === 'day');
  await restarted.evaluate(() => document.fonts.ready);
  assert.equal(await restarted.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(253, 250, 244)');
  await restarted.screenshot({ path: path.join(artifacts, 'startup-day.png') });
  assert.deepEqual(errors, []); assert.deepEqual(resources, []);
  console.log(JSON.stringify({ passed: ['native Arinox startup fonts/theme/geometry', 'startup failure/focus', 'actual preload IPC preference write', 'theme survives different localhost port', 'theme survives Electron restart'], startup, errors, resources }, null, 2));
} finally {
  await app?.close();
  await Promise.all(servers.map(instance => new Promise(resolve => instance.close(resolve))));
}
