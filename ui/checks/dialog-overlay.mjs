import assert from 'node:assert/strict';

// The caller supplies an API-mocked page. Window controls are renderer-only counters.
export async function assertDialogOverlay(page) {
  await page.addInitScript(() => {
    const counts = { minimize: 0, maximize: 0, close: 0 };
    window.__dialogWindowCounts = counts;
    window.win11Optimizer = {
      getTheme: () => 'day', setTheme: async () => true,
      minimize: () => { counts.minimize++; },
      toggleMaximize: () => { counts.maximize++; },
      close: () => { counts.close++; },
      onMaximizeChange: listener => { listener(false); return () => {}; },
      setCloseBlocked: () => true,
    };
  });
  await page.reload();
  await page.locator('main[aria-busy="false"]').waitFor();
  await page.getByRole('button', { name: '导入配置', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('dialog')?.dataset.motionState === 'open');
  assert.equal(await page.locator('dialog').evaluate(node => node.open && !node.matches(':modal')), true);
  assert.equal(await page.locator('.optimizer-workspace').evaluate(node => !!node.closest('[inert]')), true);
  assert.equal(await page.locator('.optimizer-window-controls').evaluate(node => !!node.closest('[inert]')), false);
  await page.evaluate(() => {
    const banner = document.createElement('div');
    banner.id = 'audit-dynamic-background';
    banner.innerHTML = '<button>New background action</button>';
    document.querySelector('.optimizer-app').append(banner);
  });
  await page.waitForFunction(() => document.getElementById('audit-dynamic-background')?.inert);
  await page.getByRole('button', { name: '最小化窗口' }).click();
  await page.getByRole('button', { name: '最大化窗口' }).click();
  assert.deepEqual(await page.evaluate(() => window.__dialogWindowCounts), { minimize: 1, maximize: 1, close: 0 });
  assert.equal(await page.locator('dialog').evaluate(node => node.open), true);
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => !!document.activeElement?.closest('dialog')), true);
  await page.evaluate(() => {
    const button = document.createElement('button');
    button.id = 'audit-focus-removal';
    document.querySelector('dialog').append(button);
    button.focus();
    button.remove();
  });
  await page.waitForFunction(() => !!document.activeElement?.closest('dialog'));
  await page.evaluate(() => {
    window.__dialogDisabled = [...document.querySelectorAll('dialog button,dialog input,dialog select,dialog textarea')].map(node => [node, node.disabled]);
    for (const [node] of window.__dialogDisabled) node.disabled = true;
  });
  await page.waitForFunction(() => document.activeElement === document.querySelector('dialog'));
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement === document.querySelector('dialog')), true);
  await page.evaluate(() => { for (const [node, disabled] of window.__dialogDisabled) node.disabled = disabled; });
  const controls = page.locator('dialog button:enabled');
  await page.keyboard.press('Shift+Tab');
  assert.equal(await controls.last().evaluate(node => node === document.activeElement), true);
  await controls.last().focus();
  await page.keyboard.press('Tab');
  assert.equal(await controls.first().evaluate(node => node === document.activeElement), true);
  await page.keyboard.press('Shift+Tab');
  assert.equal(await controls.last().evaluate(node => node === document.activeElement), true);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('dialog').evaluate(node => node.open && node.inert), true);
  assert.equal(await page.locator('.optimizer-workspace').evaluate(node => !!node.closest('[inert]')), true);
  await page.locator('dialog').waitFor({ state: 'detached' });
  assert.equal(await page.locator('.optimizer-dialog-backdrop').count(), 0);
  assert.equal(await page.locator('.optimizer-workspace').evaluate(node => !!node.closest('[inert]')), false);
  assert.equal(await page.locator('#audit-dynamic-background').evaluate(node => node.inert), false);
  await page.locator('#audit-dynamic-background').evaluate(node => node.remove());
  assert.equal(await page.getByRole('button', { name: '导入配置', exact: true }).evaluate(node => node === document.activeElement), true);
  await page.getByRole('button', { name: '恢复设置', exact: true }).click();
  await page.getByRole('button', { name: '使用本工具的系统还原点', exact: false }).click();
  await page.waitForFunction(() => !!document.activeElement?.closest('dialog'));
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await page.waitForFunction(() => !!document.activeElement?.closest('dialog'));
  await page.keyboard.press('Escape');
  await page.locator('dialog').waitFor({ state: 'detached' });
  await page.getByRole('button', { name: '导入配置', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('dialog')?.dataset.motionState === 'open');
  await page.locator('.optimizer-dialog-backdrop').click({ position: { x: 4, y: 4 } });
  await page.locator('dialog').waitFor({ state: 'detached' });
  assert.equal(await page.locator('.optimizer-dialog-backdrop').count(), 0);
  assert.equal(await page.locator('[inert]').count(), 0);
  return 'embedded-dialog-window-controls-focus-steps-keyboard-exit-cleanup';
}
