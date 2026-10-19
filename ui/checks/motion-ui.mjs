import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

async function sample(page, selector, action) {
  await page.evaluate(selector => {
    window.__motionFrames = [];
    window.__motionDone = false;
    const start = performance.now();
    function frame() {
      const node = document.querySelector(selector);
      const style = node && getComputedStyle(node);
      const chevron = document.querySelector('.optimizer-category-actions .optimizer-disclosure-chevron');
      window.__motionFrames.push({ t: performance.now() - start, height: node?.offsetHeight ?? 0, opacity: style?.opacity, transform: style?.transform, rotation: chevron && getComputedStyle(chevron).rotate, color: style?.backgroundColor, state: node?.dataset.motionState });
      if (performance.now() - start < 500) requestAnimationFrame(frame);
      else window.__motionDone = true;
    }
    requestAnimationFrame(frame);
  }, selector);
  await action();
  await page.waitForFunction(() => window.__motionDone);
  return page.evaluate(() => window.__motionFrames);
}

export async function runMotionChecks(page) {
  const passed = [];
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.getByRole('button', { name: '当前预设：当前系统状态', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('main')?.getAttribute('aria-busy') === 'false');
  await page.getByRole('button', { name: 'Windows 更新', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-scene-active="true"]')?.dataset.motionState === 'open');
  const caption = await page.locator('.optimizer-titlebar-button').evaluateAll(nodes => nodes.map(node => {
    const style = getComputedStyle(node);
    return { width: node.offsetWidth, height: node.offsetHeight, radius: style.borderRadius };
  }));
  assert.equal(caption.length, 4);
  assert.ok(caption.every(button => button.width === 40 && button.height === 40 && button.radius === '11px'));
  passed.push('all titlebar controls use 40x40 and 11px');

  const category = await sample(page, '[data-scene-active="true"]', () => page.getByRole('button', { name: '服务优化', exact: true }).click());
  assert.ok(category.some(frame => Number(frame.opacity) > 0 && Number(frame.opacity) < 1), 'category must have an intermediate opacity');
  assert.equal(await page.locator('[data-scene-active="false"]').count(), 0);
  const collapsed = await sample(page, '[data-scene-active="true"] .optimizer-collapse', () => page.getByRole('button', { name: '收起服务优化', exact: true }).click());
  assert.ok(new Set(collapsed.map(frame => frame.height)).size > 3, 'collapse must interpolate height');
  assert.ok(new Set(collapsed.map(frame => frame.rotation)).size > 3, 'chevron must interpolate the individual rotate property');
  assert.equal(await page.locator('[data-scene-active="true"] .optimizer-item-list').count(), 0);
  await page.getByRole('button', { name: '展开服务优化', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-scene-active="true"] .optimizer-collapse')?.dataset.motionState === 'open');
  passed.push('category enter/exit and retained collapse height');

  const hardware = await sample(page, '.optimizer-hardware', () => page.locator('.optimizer-hardware summary').click());
  assert.ok(new Set(hardware.map(frame => frame.height)).size > 3, 'hardware must interpolate height');
  assert.equal(await page.locator('.optimizer-hardware').getAttribute('open'), null);
  await page.locator('.optimizer-hardware summary').press('Space');
  await page.waitForFunction(() => document.querySelector('.optimizer-hardware .optimizer-collapse')?.dataset.motionState === 'open');
  passed.push('native summary keyboard and smooth hardware geometry');

  await page.getByRole('button', { name: '恢复设置', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('dialog')?.dataset.motionState === 'open');
  const size = await sample(page, 'dialog', () => page.getByRole('button', { name: '使用本工具的系统还原点', exact: true }).click());
  assert.ok(new Set(size.map(frame => frame.height)).size > 3, 'dialog step height must interpolate');
  assert.equal(await page.locator('dialog').evaluate(node => node.contains(document.activeElement)), true);
  await page.keyboard.press('Escape');
  await page.locator('dialog').waitFor({ state: 'detached' });
  passed.push('dialog step sizing and focus stay coherent');

  if (await page.getByRole('button', { name: '切换日间主题', exact: true }).count()) {
    await page.getByRole('button', { name: '切换日间主题', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.optimizer-theme').dataset.themeMotion !== 'running');
  }
  const theme = await sample(page, '.optimizer-theme', () => page.getByRole('button', { name: '切换夜间主题', exact: true }).click());
  assert.ok(new Set(theme.map(frame => frame.color)).size > 3, 'theme must interpolate colors');
  assert.equal(theme.at(-1).color, 'rgb(7, 10, 18)');
  await page.getByRole('button', { name: '切换日间主题', exact: true }).click();
  await page.getByRole('button', { name: '切换夜间主题', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.optimizer-theme').dataset.themeMotion !== 'running');
  assert.equal(await page.locator('.optimizer-theme').evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(7, 10, 18)');
  passed.push('theme interpolates and rapid reversal reaches latest target');

  await page.getByRole('button', { name: '收起服务优化', exact: true }).click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('[data-scene-active="true"] .optimizer-item-list').waitFor({ state: 'detached' });
  await page.getByRole('button', { name: '展开服务优化', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-scene-active="true"] .optimizer-collapse')?.dataset.motionState === 'open');
  await page.getByRole('button', { name: 'Windows 更新', exact: true }).click();
  await page.getByRole('button', { name: '服务优化', exact: true }).click();
  await page.getByRole('button', { name: 'Windows 更新', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-scene-active="true"]')?.dataset.motionState === 'open');
  assert.equal(await page.locator('[data-scene-active="false"]').count(), 0);
  assert.equal(await page.locator('[data-scene-active="true"]').count(), 1);
  passed.push('runtime reduced motion and rapid category cancellation');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  for (const theme of ['day', 'night']) {
    if (await page.locator('.optimizer-theme').getAttribute('data-theme') !== theme) await page.getByRole('button', { name: /切换.*主题/ }).click();
    await page.waitForFunction(() => document.querySelector('.optimizer-theme').dataset.themeMotion !== 'running');
    const row = page.locator('[data-scene-active="true"] .optimizer-item').last();
    await row.hover();
    await row.evaluate(async node => { await Promise.allSettled(node.getAnimations({ subtree: true }).map(animation => animation.finished)); });
    const rowStyle = await row.evaluate(node => ({ radius: getComputedStyle(node, '::before').borderRadius, layer: getComputedStyle(node, '::before').backgroundColor, background: getComputedStyle(node).backgroundColor }));
    assert.equal(rowStyle.radius, '11px');
    assert.notEqual(rowStyle.layer, 'rgba(0, 0, 0, 0)');
    assert.equal(rowStyle.background, 'rgba(0, 0, 0, 0)', 'row uses a separate rounded highlight, keeping straight separators');
    await row.screenshot({ path: fileURLToPath(new URL(`../../work/arinox-ui-remediation-2026-10-19/row-hover-${theme}.png`, import.meta.url)) });
    const log = page.locator('.optimizer-log-button');
    await log.hover();
    assert.equal(await log.evaluate(node => getComputedStyle(node).borderRadius), '11px');
    await page.keyboard.press('Tab'); await log.focus(); await page.mouse.move(1, 1);
    assert.equal(await log.evaluate(node => node.matches(':focus-visible')), true);
    assert.notEqual(await log.evaluate(node => getComputedStyle(node).backgroundColor), 'rgba(0, 0, 0, 0)');
    await log.screenshot({ path: fileURLToPath(new URL(`../../work/arinox-ui-remediation-2026-10-19/log-focus-${theme}.png`, import.meta.url)) });
  }
  passed.push('day/night item and log hover/focus highlights keep 11px corners and separators');
  return passed;
}
