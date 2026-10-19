import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runFeedbackChecks } from './feedback-ui.mjs';
import { assertDialogOverlay } from './dialog-overlay.mjs';
import { runMotionChecks } from './motion-ui.mjs';
import { runInteractionStateChecks } from './interaction-state-ui.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH ? pathToFileURL(path.join(process.env.PLAYWRIGHT_MODULE_PATH, 'index.mjs')).href : 'playwright');

const repo = fileURLToPath(new URL('../..', import.meta.url));
const out = path.join(repo, 'ui/out');
const artifacts = path.join(repo, 'work/arinox-ui');
fs.mkdirSync(artifacts, { recursive: true });
const preset = JSON.parse(fs.readFileSync(path.join(repo, 'config/presets/conservative.json'), 'utf8'));
const packageVersion = JSON.parse(fs.readFileSync(path.join(repo, 'ui/package.json'), 'utf8')).version;
const status = Object.fromEntries(Object.entries(preset.categories).map(([category, value]) => [category,
  Object.fromEntries(Object.entries(value.items).map(([item, config]) => [item, {
    kind: Object.hasOwn(config, 'execute') ? 'command' : typeof config.target === 'boolean' ? 'boolean' : 'enum',
    currentValue: config.target ?? false, available: true, applicable: true, stateConsistent: true, description: '浏览器测试状态',
  }])),
]));
const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon' };
const server = http.createServer((req, res) => {
  const file = path.resolve(out, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
  if (!file.startsWith(out + path.sep) && file !== out) { res.writeHead(403).end(); return; }
  const target = file === out ? path.join(out, 'index.html') : file;
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'Content-Type': mime[path.extname(target)] || 'application/octet-stream' });
  fs.createReadStream(target).pipe(res);
});

async function observeExit(page) {
  await page.waitForFunction(() => document.querySelector('dialog')?.dataset.motionState === 'open');
  await page.evaluate(() => {
    const dialog = document.querySelector('dialog');
    const original = dialog.textContent;
    window.__exitTrace = { start: performance.now(), closing: false, contentStable: true };
    window.__exitObserver = new MutationObserver(records => {
      for (const record of records) {
        if (record.target === dialog && dialog.dataset.motionState === 'closing') {
          window.__exitTrace.closing = true;
          window.__exitTrace.contentStable &&= dialog.textContent === original;
        }
        if ([...record.removedNodes].includes(dialog)) {
          window.__exitTrace.elapsed = performance.now() - window.__exitTrace.start;
          window.__exitTrace.removedPhase = dialog.dataset.motionState;
        }
      }
    });
    window.__exitObserver.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-motion-state', 'inert'] });
  });
}
async function assertExit(page, label) {
  await page.locator('dialog').waitFor({ state: 'detached' });
  const trace = await page.evaluate(() => { window.__exitObserver.disconnect(); return window.__exitTrace; });
  assert.equal(trace.closing, true, label + ': component must enter closing');
  assert.equal(trace.contentStable, true, label + ': payload must remain during exit');
  assert.ok(trace.elapsed >= 120, label + ': exit must use milliseconds, got ' + trace.elapsed);
  return trace;
}

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch(process.env.EDGE_EXECUTABLE_PATH ? { executablePath: process.env.EDGE_EXECUTABLE_PATH, headless: true } : { channel: 'msedge', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const errors = [], failedAssets = [], writes = [];
    let operationId, running = false, mutationsEnabled = true, failStatus = false, statusRequests = 0;
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.status() >= 400 && !response.url().includes('/api/')) failedAssets.push(response.url()); });
    const fixtureAPI = async route => {
      const req = route.request(), url = new URL(req.url());
      let data;
      if (req.method() !== 'GET') writes.push(url.pathname);
      switch (url.pathname) {
        case '/api/hardware': data = { hasSSD: true, hasHDD: false, ramGB: 32, cpuCores: 16, cpuName: 'Test processor · 16 cores', gpuName: 'Test graphics adapter', gpuBrand: 'Unknown' }; break;
        case '/api/runtime': data = { state: 'ready', administrator: true, secureRuntime: true, supportedWindows11: true, mutationsEnabled, packageVersion, windows: { caption: 'Windows 11 Pro', version: '10.0', buildNumber: '26100' } }; break;
        case '/api/status/all':
          statusRequests++;
          if (failStatus) { await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Simulated status failure' }) }); return; }
          data = status; break;
        case '/api/restore/availability': data = { available: true }; break;
        case '/api/snapshot': data = { success: true }; break;
        case '/api/optimize': operationId = req.postDataJSON().operationId; running = true; data = { operationId }; break;
        case '/api/status': data = { operationId, operation: 'optimize', running, phase: running ? 'applying' : 'done', progress: running ? 35 : 100, log: ['[OK] Mocked UI operation only'], result: running ? null : { exitCode: 0 } }; break;
        default: throw new Error('Unexpected API: ' + url.pathname);
      }
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
    };
    await page.route('**/api/**', fixtureAPI);
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.getByRole('heading', { name: 'Windows 更新', exact: true }).waitFor();
    await page.getByRole('button', { name: '当前预设：当前系统状态' }).waitFor({ state: 'visible' });
    await page.waitForFunction(() => !document.querySelector('main').getAttribute('aria-busy') || document.querySelector('main').getAttribute('aria-busy') === 'false');
    await page.evaluate(() => document.fonts.ready);
    if (!process.env.ARINOX_NEW_ONLY) {
    const metrics = () => page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth, background: getComputedStyle(document.querySelector('.optimizer-theme')).backgroundColor, radius: getComputedStyle(document.querySelector('.ax-button')).borderRadius, font: getComputedStyle(document.querySelector('h1')).fontFamily }));
    const day = await metrics();
    assert.equal(day.overflow, false); assert.equal(day.radius, '11px');
    assert.match(day.font, /Newsreader/);
    await page.screenshot({ path: path.join(artifacts, 'desktop-day.png'), fullPage: true });
    await page.getByRole('button', { name: '切换夜间主题' }).click();
    await page.waitForFunction(() => document.querySelector('.optimizer-theme').dataset.theme === 'night');
    await page.waitForFunction(() => document.querySelector('.optimizer-theme').dataset.themeMotion !== 'running');
    const night = await metrics(); assert.notEqual(day.background, night.background);
    await page.screenshot({ path: path.join(artifacts, 'desktop-night.png'), fullPage: true });
    await page.getByRole('button', { name: '切换日间主题' }).click();

    // Presets require confirmation; Escape must return focus to their trigger.
    const balanced = page.getByRole('button', { name: '平衡预设：性能与稳定兼顾' });
    await balanced.click();
    await page.locator('dialog[open]').waitFor();
    await page.waitForFunction(() => document.querySelector('dialog')?.dataset.motionState === 'open');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.querySelector('dialog').contains(document.activeElement)), true);
    await page.keyboard.press('Escape');
    await page.locator('dialog[open]').waitFor({ state: 'detached' });
    assert.equal(await balanced.evaluate(node => node === document.activeElement), true);
    await balanced.click();
    await page.locator('dialog').getByRole('button', { name: '应用预设', exact: true }).click();
    await page.locator('dialog[open]').waitFor({ state: 'detached' });
    assert.equal(await balanced.getAttribute('aria-pressed'), 'true');

    // Risky switches update targets only after confirmation; cancelling preserves the value.
    const riskySwitch = page.getByRole('switch', { name: '设置Windows 自动更新目标状态' });
    assert.equal(await riskySwitch.isChecked(), true);
    await riskySwitch.click();
    await page.getByRole('dialog').waitFor();
    await page.screenshot({ path: path.join(artifacts, 'risk-dialog.png') });
    await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();
    await page.locator('dialog[open]').waitFor({ state: 'detached' });
    assert.equal(await riskySwitch.isChecked(), true);
    await riskySwitch.click();
    await page.getByRole('dialog').getByRole('button', { name: '确认调整', exact: true }).click();
    await page.locator('dialog[open]').waitFor({ state: 'detached' });
    assert.equal(await riskySwitch.isChecked(), false);

    // A native select preserves numeric targets and the existing risk confirmation.
    const numeric = page.getByRole('combobox', { name: '设置质量更新延迟目标值' });
    assert.equal(await numeric.count(), 1);
    await numeric.selectOption('number:7');
    const risk = page.locator('dialog[open]');
    if (await risk.count()) { await page.keyboard.press('Escape'); await risk.waitFor({ state: 'detached' }); }

    const exportButton = page.getByRole('button', { name: '导出 JSON', exact: true });
    await exportButton.click();
    await page.getByRole('dialog', { name: '导出配置' }).waitFor();
    const downloadReady = page.waitForEvent('download');
    await page.getByRole('button', { name: '下载 JSON', exact: true }).click();
    assert.match((await downloadReady).suggestedFilename(), /win11-optimizer-.*\.json/);
    await page.keyboard.press('Escape');
    await page.locator('dialog[open]').waitFor({ state: 'detached' });
    assert.equal(await exportButton.evaluate(node => node === document.activeElement), true);

    await page.getByRole('button', { name: '导入配置', exact: true }).click();
    await page.locator('input[type=file]').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{broken') });
    await page.getByRole('dialog').getByRole('alert').waitFor();
    await page.locator('input[type=file]').setInputFiles({ name: 'preset.json', mimeType: 'application/json', buffer: fs.readFileSync(path.join(repo, 'config/presets/balanced.json')) });
    await page.locator('dialog[open]').waitFor({ state: 'detached' });

    for (const name of ['恢复设置', '撤销全部优化']) {
      await page.getByRole('button', { name, exact: true }).click();
      await page.locator('dialog[open]').waitFor();
      await page.keyboard.press('Escape');
      await page.locator('dialog[open]').waitFor({ state: 'detached' });
    }
    await page.getByRole('button', { name: '运行日志' }).click();
    await page.getByRole('log').waitFor();
    await page.keyboard.press('Escape');
    await page.locator('dialog[open]').waitFor({ state: 'detached' });

    // Every write is intercepted. Exercise the busy close gate without touching Windows.
    await page.getByRole('button', { name: '执行优化', exact: true }).click();
    await page.getByRole('button', { name: '开始优化', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('dialog[open]') && !document.querySelector('dialog[open] button[aria-label="关闭"]'));
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('dialog[open]').count(), 1);
    await page.mouse.click(2, 2);
    assert.equal(await page.locator('dialog[open]').count(), 1);
    running = false;
    await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).first().waitFor({ state: 'visible' });
    await page.keyboard.press('Escape');
    await page.locator('dialog[open]').waitFor({ state: 'detached' });

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 390, height: 844 });
    await exportButton.click();
    await page.waitForFunction(() => document.querySelector('dialog')?.dataset.motionState === 'open');
    assert.equal(await page.locator('dialog').evaluate(node => node.getBoundingClientRect().right <= innerWidth && node.getBoundingClientRect().left >= 0), true);
    await page.keyboard.press('Escape');
    await page.locator('dialog[open]').waitFor({ state: 'detached' });
    assert.equal((await metrics()).overflow, false);
    await page.screenshot({ path: path.join(artifacts, 'mobile-day.png'), fullPage: true });

    // All 14 navigation entries remain reachable and update the selected category.
    const navigation = page.getByRole('navigation', { name: '优化分类' }).getByRole('button');
    assert.equal(await navigation.count(), 14);
    for (let index = 0; index < 14; index++) {
      const item = navigation.nth(index);
      await item.click();
      assert.equal(await item.getAttribute('aria-current'), 'page');
      assert.equal((await metrics()).overflow, false);
    }
    // Read-only capabilities and malformed stored configuration must still gate writes.
    mutationsEnabled = false;
    await page.reload();
    await page.getByRole('heading', { name: 'Windows 更新', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '执行优化', exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: '恢复设置', exact: true }).isDisabled(), true);
    await page.evaluate(() => localStorage.setItem('win11-optimizer-config', '{original-broken-record'));
    await page.reload();
    await page.getByRole('button', { name: '放弃原配置', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => localStorage.getItem('win11-optimizer-config')), '{original-broken-record');
    await page.getByRole('button', { name: '放弃原配置', exact: true }).click();
    await page.keyboard.press('Escape');
    await page.locator('dialog[open]').waitFor({ state: 'detached' });
    assert.equal(await page.evaluate(() => localStorage.getItem('win11-optimizer-config')), '{original-broken-record');
    // Repeated Current clicks must refresh, including recovery from the first failed read.
    await page.evaluate(() => localStorage.removeItem('win11-optimizer-config'));
    mutationsEnabled = true;
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.reload();
    await page.waitForFunction(() => document.querySelector('main')?.getAttribute('aria-busy') === 'false');
    const current = page.getByRole('button', { name: '当前预设：当前系统状态' });
    const beforeRefresh = statusRequests;
    await Promise.all([
      page.waitForResponse(response => new URL(response.url()).pathname === '/api/status/all', { timeout: 2000 }),
      current.click(),
    ]);
    await page.waitForFunction(() => document.querySelector('main')?.getAttribute('aria-busy') === 'false');
    assert.equal(statusRequests, beforeRefresh + 1, 'Current must refresh even when already selected');

    failStatus = true;
    mutationsEnabled = false;
    await page.setViewportSize({ width: 1024, height: 720 });
    await page.reload();
    await page.getByText('系统状态读取失败，请选择“当前”重试。').waitFor();
    const logIsVisible = await page.getByRole('button', { name: '运行日志' }).evaluate(node => {
      const rect = node.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return rect.top >= 0 && rect.bottom <= innerHeight && !!hit && node.contains(hit);
    });
    assert.equal(logIsVisible, true, 'Log entry must remain visible at 1024x720 with error banners');
    await page.getByRole('button', { name: '运行日志' }).click();
    await page.getByRole('log').waitFor();
    await page.keyboard.press('Escape');
    await page.locator('dialog[open]').waitFor({ state: 'detached' });
    failStatus = false;
    const beforeRetry = statusRequests;
    await Promise.all([
      page.waitForResponse(response => new URL(response.url()).pathname === '/api/status/all', { timeout: 2000 }),
      current.click(),
    ]);
    await page.getByText('系统状态读取失败，请选择“当前”重试。').waitFor({ state: 'detached' });
    assert.equal(statusRequests, beforeRetry + 1, 'Current must retry a failed initial read');
    assert.equal(await page.getByRole('button', { name: '执行优化', exact: true }).isDisabled(), true);
    assert.deepEqual(errors, []); assert.deepEqual(failedAssets, []);
    assert.deepEqual(writes, ['/api/snapshot', '/api/optimize']);
    const extra = [];
    mutationsEnabled = true;
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.reload();
    await page.waitForFunction(() => document.querySelector('main')?.getAttribute('aria-busy') === 'false');
    await page.evaluate(() => {
      const theme = document.querySelector('.optimizer-theme');
      theme.style.setProperty('--ax-motion-duration-base', '.2s');
      theme.style.setProperty('--ax-motion-duration-slow', '.32s');
    });
    await page.getByRole('button', { name: '导入配置', exact: true }).click();
    await observeExit(page);
    await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();
    const ordinaryExit = await assertExit(page, 'Production seconds token');
    extra.push('production seconds token yields visible exit duration');

    await page.getByRole('switch', { name: '设置Windows 自动更新目标状态' }).click();
    await observeExit(page);
    await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();
    const riskExit = await assertExit(page, 'Risk confirmation');
    assert.equal(await page.getByRole('switch', { name: '设置Windows 自动更新目标状态' }).evaluate(e => e === document.activeElement), true);
    extra.push('risk confirmation retains payload through exit and returns focus');

    await page.getByRole('button', { name: '平衡预设：性能与稳定兼顾' }).click();
    await observeExit(page);
    await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();
    await assertExit(page, 'Preset confirmation');
    extra.push('preset payload retained through exit');

    await page.getByRole('button', { name: '服务优化', exact: true }).click();
    await page.locator('main').evaluate(e => { e.scrollTop = 250; });
    assert.ok(await page.locator('main').evaluate(e => e.scrollTop > 100));
    await page.getByRole('button', { name: '隐私优化', exact: true }).click();
    assert.equal(await page.locator('main').evaluate(e => e.scrollTop), 0);
    extra.push('category navigation resets the content viewport');

    const previousTheme = await page.locator('.optimizer-theme').getAttribute('data-theme');
    await page.getByRole('button', { name: /切换.*主题/ }).click();
    const savedTheme = previousTheme === 'day' ? 'night' : 'day';
    assert.equal(await page.evaluate(() => localStorage.getItem('win11-optimizer-theme')), savedTheme);
    await page.reload();
    await page.waitForFunction(value => document.querySelector('.optimizer-theme')?.dataset.theme === value, savedTheme);
    extra.push('theme preference survives reload');
    await page.evaluate(() => {
      window.__setItem = Storage.prototype.setItem;
      Storage.prototype.setItem = () => { throw new DOMException('Blocked storage', 'QuotaExceededError'); };
    });
    await page.getByRole('button', { name: /切换.*主题/ }).click();
    await page.getByText('主题未保存，仅本次会话生效', { exact: true }).waitFor();
    assert.equal(await page.locator('.optimizer-theme').getAttribute('data-theme'), previousTheme);
    await page.evaluate(() => { Storage.prototype.setItem = window.__setItem; });
    extra.push('theme storage failure keeps UI usable and reports unsaved state');

    failStatus = true;
    mutationsEnabled = false;
    await page.setViewportSize({ width: 1024, height: 720 });
    await page.evaluate(() => localStorage.setItem('win11-optimizer-config', '{isolated-broken-record'));
    await page.reload();
    await page.getByText('系统状态读取失败，请选择“当前”重试。').waitFor();
    assert.ok(await page.locator('.optimizer-navigation').evaluate(e => e.clientHeight >= 80));
    for (const label of ['安全优化', 'Windows 更新']) {
      await page.getByRole('button', { name: label, exact: true }).click();
      await page.getByRole('heading', { name: label, exact: true }).waitFor();
    }
    const accessibleLog = await page.getByRole('button', { name: '运行日志' }).evaluate(node => {
      const r = node.getBoundingClientRect();
      return node.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
    });
    assert.equal(accessibleLog, true);
    assert.equal(await page.evaluate(() => localStorage.getItem('win11-optimizer-config')), '{isolated-broken-record');
    await page.screenshot({ path: path.join(artifacts, 'combined-errors-fixed.png'), fullPage: true });
    extra.push('all categories and log reachable with combined errors at minimum window');
    assert.deepEqual(errors, []); assert.deepEqual(failedAssets, []);
    console.log(JSON.stringify({ additionalPassed: extra, ordinaryExit, riskExit }, null, 2));
    console.log(JSON.stringify({ passed: ['day/night tokens', '11px controls', 'offline fonts', 'preset confirmation', 'risk switch cancel/confirm', 'keyboard focus return', 'native select', 'JSON export/import', 'restore/undo/log dialogs', 'busy Escape/backdrop gates', '390px layout', 'all 14 categories', 'reduced motion', 'read-only gate', 'corrupt storage preserved', 'Current repeat refresh', 'Current failed-read retry', '1024x720 error-banner log access', 'no console or asset errors'], day, night, interceptedWrites: writes }, null, 2));
    }
    mutationsEnabled = true; failStatus = false; running = false;
    const extraContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const extraPage = await extraContext.newPage();
    extraPage.setDefaultTimeout(15000);
    extraPage.on('pageerror', error => errors.push(error.message));
    await extraPage.route('**/api/**', fixtureAPI);
    await extraPage.goto(`http://127.0.0.1:${server.address().port}`);
    await extraPage.waitForFunction(() => document.querySelector('main')?.getAttribute('aria-busy') === 'false');
    const feedbackPassed = await runFeedbackChecks({ page: extraPage, preset });
    const dialogPassed = await assertDialogOverlay(extraPage);
    const motionPassed = await runMotionChecks(extraPage);
    const stateChecks = await runInteractionStateChecks({ page: extraPage, status, preset, finishOperation: () => { running = false; } });
    assert.deepEqual(errors, []); assert.deepEqual(failedAssets, []);
    console.log(JSON.stringify({ feedbackPassed, dialogPassed, motionPassed, statePassed: stateChecks.passed }, null, 2));
    await extraContext.close();
    await context.close();
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
