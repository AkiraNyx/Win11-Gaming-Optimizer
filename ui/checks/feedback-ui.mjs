import assert from 'node:assert/strict';

// Run against the existing isolated API/browser fixture, never the production service.
export async function runFeedbackChecks({ page, preset }) {
  const passed = [];
  const closeDialog = async () => {
    await page.keyboard.press('Escape');
    await page.locator('dialog[open]').waitFor({ state: 'detached' });
  };
  const openExport = async () => {
    await page.getByRole('button', { name: '导出 JSON', exact: true }).click();
    await page.getByRole('dialog', { name: '导出配置' }).waitFor();
  };
  const leaveTooltip = async () => {
    await page.mouse.move(1, 1);
    // Radix installs its pointer-grace listener after leaving the trigger.
    await page.evaluate(() => new Promise(requestAnimationFrame));
    await page.mouse.move(4, 4);
    await page.locator('[data-slot="tooltip-content"]').waitFor({ state: 'detached' });
  };
  await page.getByRole('button', { name: 'Windows 更新', exact: true }).click();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  for (const theme of ['day', 'night']) {
    if (await page.locator('.optimizer-theme').getAttribute('data-theme') !== theme) {
      await page.getByRole('button', { name: /切换.*主题/ }).click();
    }
    await page.getByRole('button', { name: '收起Windows 更新', exact: true }).hover();
    const tooltip = page.locator('[data-slot="tooltip-content"]');
    await tooltip.waitFor();
    const style = await tooltip.evaluate(node => {
      const css = getComputedStyle(node);
      return { background: css.backgroundColor, arrow: getComputedStyle(node.querySelector('svg')).fill, radius: css.borderRadius, duration: css.animationDuration, easing: css.animationTimingFunction };
    });
    assert.equal(style.arrow, style.background, `${theme}: arrow shares tooltip surface`);
    assert.equal(style.radius, '16px');
    assert.equal(style.duration, '0.12s');
    assert.notEqual(style.easing, 'linear');
    await tooltip.evaluate(node => {
      window.__tooltipClosing = false;
      new MutationObserver((_, observer) => {
        if (node.dataset.state === 'closed') { window.__tooltipClosing = true; observer.disconnect(); }
      }).observe(node, { attributes: true, attributeFilter: ['data-state'] });
    });
    await leaveTooltip();
    assert.equal(await page.evaluate(() => window.__tooltipClosing), true, 'Radix retains closing content for its CSS exit');
  }
  passed.push('day/night tooltip surface, arrow, 16px radius and token-based exit presence');
  await page.getByRole('button', { name: '收起Windows 更新', exact: true }).hover();
  await page.locator('[data-slot="tooltip-content"]').waitFor();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.ok(await page.locator('[data-slot="tooltip-content"]').evaluate(node => parseFloat(getComputedStyle(node).animationDuration) <= 0.001));
  await leaveTooltip();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  passed.push('tooltip responds to reduced motion while mounted and exits cleanly');

  await page.evaluate(() => {
    window.__feedbackMock = {
      clipboard: Object.getOwnPropertyDescriptor(navigator, 'clipboard'),
      setTimeout: window.setTimeout, clearTimeout: window.clearTimeout,
      writes: [], pending: [], timers: [], cancelled: [], mode: 'ok',
    };
    const mock = window.__feedbackMock;
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText(payload) {
      mock.writes.push(payload);
      if (mock.mode === 'reject') return Promise.reject(new Error('Isolated clipboard denial'));
      if (mock.mode === 'deferred') return new Promise(resolve => mock.pending.push(resolve));
      return Promise.resolve();
    } } });
    window.setTimeout = (fn, delay, ...args) => {
      const id = mock.setTimeout.call(window, fn, delay, ...args);
      if (delay === 2000) mock.timers.push(id);
      return id;
    };
    window.clearTimeout = id => { mock.cancelled.push(id); mock.clearTimeout.call(window, id); };
  });
  try {
    await openExport();
    const firstPayload = await page.locator('dialog pre').textContent();
    await page.getByRole('button', { name: '复制到剪贴板', exact: true }).click();
    await page.getByRole('button', { name: '已复制', exact: true }).waitFor();
    await page.getByRole('button', { name: '已复制', exact: true }).click();
    await page.getByRole('button', { name: '已复制', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => {
      const mock = window.__feedbackMock;
      return mock.timers.length === 2 && mock.cancelled.includes(mock.timers[0]);
    }), true, 'repeated copy cancels the previous feedback timer');
    await closeDialog();
    assert.equal(await page.evaluate(() => {
      const mock = window.__feedbackMock;
      return mock.cancelled.includes(mock.timers.at(-1));
    }), true, 'close cancels the current feedback timer');
    await page.getByRole('switch', { name: '设置P2P 更新分发目标状态', exact: true }).click();
    await openExport();
    assert.notEqual(await page.locator('dialog pre').textContent(), firstPayload);
    assert.equal(await page.getByRole('button', { name: '复制到剪贴板', exact: true }).count(), 1);
    await page.evaluate(() => { window.__feedbackMock.mode = 'deferred'; });
    await page.getByRole('button', { name: '复制到剪贴板', exact: true }).click();
    await closeDialog();
    await openExport();
    await page.evaluate(() => { window.__feedbackMock.pending.shift()(); });
    await page.waitForFunction(() => !document.querySelector('dialog').textContent.includes('已复制'));
    assert.equal(await page.getByRole('button', { name: '复制到剪贴板', exact: true }).count(), 1);
    await page.evaluate(() => { window.__feedbackMock.mode = 'reject'; });
    await page.getByRole('button', { name: '复制到剪贴板', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: '无法访问剪贴板' }).waitFor();
    await closeDialog();
    await openExport();
    assert.equal(await page.getByRole('alert').filter({ hasText: '无法访问剪贴板' }).count(), 0);
    await closeDialog();
    passed.push('copy feedback binds to payload/session; repeated, deferred and failed writes reset safely');
  } finally {
    await page.evaluate(() => {
      const mock = window.__feedbackMock;
      if (mock.clipboard) Object.defineProperty(navigator, 'clipboard', mock.clipboard);
      else delete navigator.clipboard;
      window.setTimeout = mock.setTimeout; window.clearTimeout = mock.clearTimeout;
      delete window.__feedbackMock;
    });
  }

  const legacy = { version: '1.0', preset: 'custom', categories: Object.fromEntries(Object.entries(preset.categories).map(([category, value]) => [category, {
    enabled: true, items: Object.fromEntries(Object.keys(value.items).map(item => [item, category === 'serviceOptimization' ? { enabled: false, action: 'manual' } : false])),
  }])) };
  const selectFile = json => page.locator('input[type="file"]').setInputFiles({ name: 'isolated.json', mimeType: 'application/json', buffer: Buffer.from(json) });
  await page.getByRole('button', { name: '导入配置', exact: true }).click();
  await selectFile(JSON.stringify(legacy));
  await page.getByRole('dialog', { name: '确认迁移旧版配置' }).waitFor();
  const summary = await page.locator('dialog dl').textContent();
  const chooserReady = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '选择其他文件', exact: true }).click();
  await (await chooserReady).setFiles([]);
  assert.equal(await page.locator('dialog dl').textContent(), summary, 'cancelled replacement preserves legacy preview');
  await selectFile('{invalid replacement');
  await page.getByRole('dialog').getByRole('alert').waitFor();
  assert.equal(await page.locator('dialog dl').textContent(), summary, 'invalid replacement preserves legacy preview');
  passed.push('cancelled and invalid replacement files preserve the existing legacy preview');

  await page.evaluate(() => {
    window.__savedFileReader = window.FileReader;
    window.__pendingReaders = [];
    window.FileReader = class {
      readAsText(file) { this.file = file.name; window.__pendingReaders.push(this); }
      abort() { this.aborted = true; }
    };
  });
  try {
    await selectFile('first deferred read');
    assert.equal(await page.getByRole('button', { name: '确认迁移并导入', exact: true }).isDisabled(), true);
    await selectFile('second deferred read');
    const replacement = structuredClone(legacy);
    replacement.categories.windowsUpdate.items.deferQualityUpdates = true;
    await page.evaluate(json => {
      const [old, current] = window.__pendingReaders;
      if (!old.aborted) throw new Error('Superseded reader was not aborted');
      current.result = json; current.onload();
      old.result = '{stale invalid result'; old.onload();
    }, JSON.stringify(replacement));
    await page.waitForFunction(original => document.querySelector('dialog dl').textContent !== original, summary);
    assert.equal(await page.getByRole('dialog').getByRole('alert').count(), 0, 'stale reader cannot overwrite current feedback');
    assert.equal(await page.getByRole('button', { name: '确认迁移并导入', exact: true }).isEnabled(), true);
    await selectFile('read interrupted by close');
    await closeDialog();
    await page.getByRole('button', { name: '导入配置', exact: true }).click();
    await page.evaluate(json => {
      const pending = window.__pendingReaders.at(-1);
      if (!pending.aborted) throw new Error('Closed reader was not aborted');
      pending.result = json; pending.onload();
    }, JSON.stringify(preset));
    assert.equal(await page.getByRole('dialog', { name: '导入配置', exact: true }).count(), 1, 'closed reader cannot import into a new session');
    await closeDialog();
    passed.push('replacement reads disable stale confirmation, abort predecessors and ignore late/closed callbacks');
  } finally {
    await page.evaluate(() => { window.FileReader = window.__savedFileReader; delete window.__savedFileReader; delete window.__pendingReaders; });
  }
  return passed;
}
