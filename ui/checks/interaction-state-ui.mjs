import assert from 'node:assert/strict';

const currentName = '当前预设：当前系统状态';
const json = data => ({ contentType: 'application/json', body: JSON.stringify(data) });
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

// The supplied page already blocks real APIs. Every override is removed on exit.
export async function runInteractionStateChecks({ page, status, preset, finishOperation }) {
  assert.ok(preset.categories, 'The caller must supply the isolated preset fixture');
  const passed = [], routes = [];
  const route = async (pattern, handler) => { routes.push([pattern, handler]); await page.route(pattern, handler); };
  const unroute = async (pattern, handler) => { await page.unroute(pattern, handler); routes.splice(routes.findIndex(entry => entry[1] === handler), 1); };
  const current = () => page.getByRole('button', { name: currentName, exact: true });
  const ready = () => page.waitForFunction(() => document.querySelector('main')?.getAttribute('aria-busy') === 'false');
  const focusedInside = () => page.waitForFunction(() => !!document.activeElement?.closest('dialog'));
  const closeDialog = async () => { await page.keyboard.press('Escape'); await page.locator('dialog').waitFor({ state: 'detached' }); };
  const closedLock = blocked => page.waitForFunction(value => window.__interactionCloseBlocked === value, blocked);
  const released = [];
  try {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await ready();
    await page.getByText('正在读取系统状态，请稍候…', { exact: true }).waitFor({ state: 'detached' });
    await page.evaluate(() => {
      const bridge = window.win11Optimizer;
      if (!bridge) throw new Error('Use the isolated window-counter bridge, not a real Electron window');
      const original = bridge.setCloseBlocked;
      window.__interactionOriginalCloseBlock = original;
      window.__interactionLockCalls = [];
      window.__interactionCloseBlocked = false;
      bridge.setCloseBlocked = blocked => {
        window.__interactionLockCalls.push(blocked);
        window.__interactionCloseBlocked = blocked;
        return original?.(blocked) ?? true;
      };
    });

    const statusGate = deferred(), statusCalled = deferred(); released.push(statusGate.resolve);
    const waitStatus = async request => { statusCalled.resolve(); await statusGate.promise; await request.fulfill(json(status)); };
    await route('**/api/status/all', waitStatus);
    await page.evaluate(() => {
      window.__interactionLoadingFrames = [];
      window.__interactionLoadingDone = false;
      const start = performance.now();
      function sample() {
        const banner = [...document.querySelectorAll('[role="status"]')].find(node => node.textContent.includes('正在读取系统状态，请稍候'));
        const root = banner?.closest('.optimizer-collapse');
        window.__interactionLoadingFrames.push({ t: performance.now() - start, height: root?.getBoundingClientRect().height ?? 0, full: root?.firstElementChild?.getBoundingClientRect().height ?? 0 });
        if (performance.now() - start < 500) requestAnimationFrame(sample);
        else window.__interactionLoadingDone = true;
      }
      requestAnimationFrame(sample);
    });
    await current().focus(); await page.keyboard.press('Space'); await statusCalled.promise;
    assert.equal(await current().isDisabled(), true);
    await page.waitForFunction(() => window.__interactionLoadingDone);
    const loadingFrames = await page.evaluate(() => window.__interactionLoadingFrames);
    assert.ok(loadingFrames.some(frame => frame.height > .5 && frame.height < frame.full - .5), 'The status banner must interpolate its height');
    statusGate.resolve(); await ready();
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '当前预设：当前系统状态');
    assert.equal(await current().isDisabled(), false);
    await unroute('**/api/status/all', waitStatus);
    passed.push('Current Space request disables controls, animates banner and restores focus');

    await page.getByRole('navigation', { name: '优化分类' }).getByRole('button', { name: /^Windows 更新/ }).click();
    await page.waitForFunction(() => document.querySelector('[data-scene-active="true"]')?.dataset.motionState === 'open');
    const unknown = Object.fromEntries(Object.entries(status).map(([category, items]) => [category,
      Object.fromEntries(Object.entries(items).map(([id, item]) => [id, { ...item, available: false, currentValue: null }])),
    ]));
    const unknownStatus = request => request.fulfill(json(unknown));
    await route('**/api/status/all', unknownStatus);
    await page.getByRole('button', { name: '同步为当前状态', exact: true }).click();
    await page.getByRole('button', { name: '关闭分类同步错误' }).waitFor();
    await ready();
    await page.getByRole('button', { name: '关闭分类同步错误' }).click();
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '当前预设：当前系统状态');
    await unroute('**/api/status/all', unknownStatus);
    await current().click(); await ready();
    passed.push('unknown category synchronization error dismisses and returns focus to Current');

    const p2p = page.getByRole('switch', { name: '设置P2P 更新分发目标状态', exact: true });
    await p2p.click();
    if (await page.locator('dialog').count()) {
      await page.getByRole('dialog').getByRole('button', { name: '确认调整', exact: true }).click();
      await page.locator('dialog').waitFor({ state: 'detached' });
    }
    const snapshotFailure = request => request.fulfill({ status: 500, ...json({ error: 'Isolated snapshot failure' }) });
    await route('**/api/snapshot', snapshotFailure);
    await page.getByRole('button', { name: '执行优化', exact: true }).click();
    await page.getByRole('button', { name: '开始优化', exact: true }).click();
    await page.getByRole('button', { name: '不保存快照，继续优化', exact: true }).waitFor();
    await focusedInside(); await closedLock(false);
    const snapshotLocks = await page.evaluate(() => window.__interactionLockCalls);
    assert.ok(snapshotLocks.includes(true) && snapshotLocks.at(-1) === false, 'Snapshot failure must release the startup close lock');
    await unroute('**/api/snapshot', snapshotFailure);
    await page.getByRole('button', { name: '不保存快照，继续优化', exact: true }).click();
    await page.getByRole('progressbar', { name: '优化进度' }).waitFor();
    await closedLock(true); await focusedInside();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('dialog').evaluate(node => node.open && !node.inert), true);
    await finishOperation();
    await page.getByRole('button', { name: '重启电脑', exact: true }).waitFor();
    await closedLock(false); await focusedInside();
    await closeDialog(); await ready();
    passed.push('snapshot failure and Optimize running/done preserve focus, Escape gate and close-lock lifecycle');

    for (const operation of [
      { path: 'restore', open: '恢复设置', action: '恢复最近一次优化前设置', done: '最近一次优化记录已恢复，建议重启电脑。' },
      { path: 'uninstall', open: '撤销全部优化', action: '撤销全部优化', done: '所有尚未撤销的优化记录均已恢复，建议重启电脑。' },
    ]) {
      const gate = deferred(), called = deferred(); released.push(gate.resolve);
      const handler = async request => { called.resolve(); await gate.promise; await request.fulfill(json({ success: true })); };
      await route(`**/api/${operation.path}`, handler);
      await page.getByRole('button', { name: operation.open, exact: true }).click();
      await page.getByRole('dialog').getByRole('button', { name: operation.action, exact: true }).click();
      await called.promise; await closedLock(true); await focusedInside();
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('dialog').evaluate(node => node.open && !node.inert), true);
      gate.resolve();
      await page.getByText(operation.done, { exact: true }).waitFor();
      await closedLock(false); await focusedInside();
      await closeDialog(); await ready();
      await unroute(`**/api/${operation.path}`, handler);
      passed.push(`${operation.path} deferred request blocks Escape/window close and releases after refresh`);
    }

    const runtime = await page.evaluate(async () => (await fetch('/api/runtime')).json());
    const retryGate = deferred(), retryCalled = deferred(); released.push(retryGate.resolve);
    let runtimeRequests = 0;
    const retryRuntime = async request => {
      if (runtimeRequests++ === 0) { await request.fulfill({ status: 500, ...json({ error: 'Isolated runtime failure' }) }); return; }
      retryCalled.resolve(); await retryGate.promise; await request.fulfill(json(runtime));
    };
    await route('**/api/runtime', retryRuntime);
    await page.reload();
    const retry = page.getByRole('button', { name: '重新检查', exact: true });
    await retry.waitFor(); await retry.focus(); await page.keyboard.press('Space'); await retryCalled.promise;
    await page.getByRole('button', { name: /^(重新检查|正在重试)$/ }).waitFor({ state: 'detached' });
    retryGate.resolve(); await ready();
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '当前预设：当前系统状态');
    passed.push('removed runtime retry control returns focus to Current when ready');
    return { passed, loadingFrames };
  } finally {
    for (const release of released) release();
    for (const [pattern, handler] of routes.reverse()) await page.unroute(pattern, handler);
    await page.evaluate(() => {
      if (window.__interactionOriginalCloseBlock && window.win11Optimizer) window.win11Optimizer.setCloseBlocked = window.__interactionOriginalCloseBlock;
      delete window.__interactionOriginalCloseBlock;
    }).catch(() => {});
  }
}
