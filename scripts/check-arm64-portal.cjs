const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium, firefox } = require('playwright');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'artifacts', 'arm64-portal');

async function checkDropdown(page, engine) {
  await page.locator('.portal-appearance > summary').click();
  const select = page.getByLabel('共享页面主题风格');
  const native = await select.evaluate(el => getComputedStyle(el).appearance === 'base-select');
  assert.equal(native, engine === 'chromium', 'Exercise both the native picker and the compatibility menu');
  for (const index of [1, 0]) {
    await select.click();
    const option = native ? select.locator('option').nth(index) : page.locator('.select-menu [role=option]').nth(index);
    await option.waitFor({ state: 'visible' });
    // A short click must leave the menu open after the pointer has been released.
    await page.waitForTimeout(750);
    assert.ok(await option.isVisible());
    if (index === 1) await page.screenshot({ path: path.join(output, engine + '-dropdown.png') });
    const rect = await option.boundingBox();
    await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
    await page.waitForFunction(({ el, index }) => el.selectedIndex === index, { el: await select.elementHandle(), index });
  }
  await page.locator('.portal-appearance > summary').click();
  console.log(engine, native ? 'native picker' : 'compatibility menu', 'stayed open for 750 ms on each of two clicks, both selections applied');
}

async function checkButton(page, engine) {
  await page.getByRole('button', { name: '替换服务文件', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '替换服务文件' });
  await dialog.getByRole('button', { name: '停止服务并继续' }).click();
  const button = dialog.getByRole('button', { name: '上传并替换' });
  await button.waitFor();
  for (const state of ['disabled', 'enabled']) {
    if (state === 'enabled') await dialog.locator('input[type=file]').setInputFiles({
      name: 'updated.jar', mimeType: 'application/java-archive', buffer: Buffer.from('layout fixture'),
    });
    assert.equal(await button.isDisabled(), state === 'disabled');
    await page.evaluate(() => document.fonts.ready);
    await dialog.evaluate(async el => {
      await Promise.allSettled(el.getAnimations({ subtree: true })
        .filter(animation => Number.isFinite(animation.effect.getComputedTiming().endTime)).map(animation => animation.finished));
    });
    const { left, right } = await button.evaluate(el => {
      const bounds = el.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(el.querySelector('.motion-text-current'));
      const label = range.getBoundingClientRect();
      return { left: label.left - bounds.left, right: bounds.right - label.right };
    });
    console.log(engine, state, 'CSS pixels', { left, right });
    assert.ok(left > 0 && Math.abs(left - right) < 1, 'Upload text must be centered');
    await button.screenshot({ path: path.join(output, engine + '-upload-' + state + '.png') });
  }
}

async function main() {
  assert.equal(process.platform, 'linux');
  assert.equal(process.arch, 'arm64');
  await fs.mkdir(output, { recursive: true });
  const { portalFixture } = await import('../electron/portal-fixture.mjs');
  const fixture = await portalFixture(root);
  try {
    await fixture.host.start({ ...fixture.options, host: '127.0.0.1', services: {
      ...fixture.options.services, jar: { enabled: true, edit: true, control: true },
    } });
    for (const type of [chromium, firefox]) {
      const browser = await type.launch({ headless: false });
      try {
        const engine = type.name();
        console.log(process.platform, process.arch, engine, browser.version());
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        await page.goto('http://127.0.0.1:' + fixture.options.port + '/#jar');
        await page.locator('.portal-login input[type=password]').fill(fixture.options.password);
        await page.locator('.portal-login button[type=submit]').click();
        await checkDropdown(page, engine);
        await checkButton(page, engine);
        await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();
      } finally { await browser.close(); }
    }
  } finally { await fixture.close(); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
