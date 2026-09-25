import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const runtimePath = path.join(root, 'assets/runtime/immersive-atmosphere.js');

const fixtures = [
  { name: 'desktop Chromium', engine: chromium, viewport: { width: 1280, height: 800 }, verifyAutoStop: true },
  { name: 'phone Chromium', engine: chromium, viewport: { width: 390, height: 844 } },
  { name: 'desktop WebKit', engine: webkit, viewport: { width: 1280, height: 800 } },
  { name: 'phone WebKit', engine: webkit, viewport: { width: 390, height: 844 } },
];

const pageFixture = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
  <style>
    :root { --accent: #f2bd58; --sans: system-ui, sans-serif; }
    html, body { width: 100%; min-height: 100%; margin: 0; background: #0b0d17; color: #fff; }
    .utilities { display: flex; gap: 8px; }
    .icon-button { width: 44px; height: 44px; }
  </style>
</head>
<body>
  <main id="app">
    <button id="playButton" type="button">Play</button>
    <div class="utilities"><button id="queueButton" class="icon-button" type="button">Queue</button></div>
  </main>
  <div id="providerStage"></div>
  <div id="youtubeStage"></div>
  <div id="installBanner"></div>
  <section id="songSheet" aria-hidden="true"></section>
</body>
</html>`;

async function waitFor(page, predicate, message, timeout = 5000) {
  try {
    await page.waitForFunction(predicate, null, { timeout });
  } catch (error) {
    throw new Error(`${message}: ${error.message}`);
  }
}

async function runFixture({ name, engine, viewport, verifyAutoStop = false }) {
  const browser = await engine.launch({ headless: true });
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });

  try {
    await page.setContent(pageFixture, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      window.__atmosphereEvents = [];
      window.addEventListener('garba:atmosphere-change', (event) => {
        window.__atmosphereEvents.push(event.detail);
      });
    });
    await page.addScriptTag({ path: runtimePath });
    await waitFor(page, () => Boolean(window.GARBA_ATMOSPHERE && document.querySelector('#atmosphereButton')), `${name}: runtime did not mount`);

    const button = page.locator('#atmosphereButton');
    const panel = page.locator('#atmospherePanel');
    const test = page.locator('.atmosphere-test');
    const slider = page.locator('#atmosphereLevel');

    assert.equal(await button.getAttribute('aria-expanded'), 'false', `${name}: trigger must start collapsed`);
    assert.equal(await panel.getAttribute('aria-modal'), 'true', `${name}: panel must be modal`);
    assert.equal(await slider.getAttribute('min'), '5', `${name}: intensity floor must remain 5%`);
    assert.equal(await slider.isDisabled(), true, `${name}: Off mode must disable intensity`);

    await button.click();
    await waitFor(page, () => !document.querySelector('#atmospherePanel')?.hidden, `${name}: panel did not open`);
    await waitFor(page, () => document.activeElement?.matches('.atmosphere-mode[aria-pressed="true"]'), `${name}: selected mode did not receive initial focus`);
    assert.equal(await button.getAttribute('aria-expanded'), 'true', `${name}: trigger did not expose open state`);
    assert.equal(await page.locator('#app').evaluate((node) => node.hasAttribute('inert')), true, `${name}: background app was not made inert`);

    const bounds = await panel.boundingBox();
    assert.ok(bounds, `${name}: panel has no rendered bounds`);
    assert.ok(bounds.x >= -0.5 && bounds.y >= -0.5, `${name}: panel begins outside viewport`);
    assert.ok(bounds.x + bounds.width <= viewport.width + 0.5, `${name}: panel overflows viewport horizontally`);
    assert.ok(bounds.y + bounds.height <= viewport.height + 0.5, `${name}: panel overflows viewport vertically`);

    await page.locator('.atmosphere-mode[data-mode="crowd"]').click();
    await waitFor(page, () => window.GARBA_ATMOSPHERE?.mode === 'crowd', `${name}: Courtyard mode did not apply`);
    assert.equal(await slider.isDisabled(), false, `${name}: enabled mode must enable intensity`);
    assert.equal(await test.getAttribute('aria-pressed'), 'false', `${name}: selecting a mode must not auto-start Test`);
    assert.equal(await page.evaluate(() => window.GARBA_ATMOSPHERE.active), false, `${name}: paused mode selection must remain silent`);

    await test.click();
    await waitFor(page, () => document.querySelector('.atmosphere-test')?.getAttribute('aria-pressed') === 'true' && window.GARBA_ATMOSPHERE?.active === true, `${name}: explicit Test did not become active`);
    assert.equal(await test.getAttribute('aria-label'), 'Stop atmosphere test', `${name}: active Test label is not truthful`);

    await test.click();
    await waitFor(page, () => document.querySelector('.atmosphere-test')?.getAttribute('aria-pressed') === 'false' && window.GARBA_ATMOSPHERE?.active === false, `${name}: second Test tap did not stop preview`);

    await test.click();
    await waitFor(page, () => document.querySelector('.atmosphere-test')?.getAttribute('aria-pressed') === 'true', `${name}: Test did not restart`);
    await page.evaluate(() => document.querySelector('#app')?.classList.add('is-playing'));
    await waitFor(page, () => window.GARBA_ATMOSPHERE?.playbackSynced === true && document.querySelector('.atmosphere-test')?.getAttribute('aria-pressed') === 'false', `${name}: song playback did not take control back from Test`);
    assert.equal(await page.evaluate(() => window.GARBA_ATMOSPHERE.active), true, `${name}: Atmosphere should remain active while playback is active`);

    await page.evaluate(() => document.querySelector('#app')?.classList.remove('is-playing'));
    await waitFor(page, () => window.GARBA_ATMOSPHERE?.playbackSynced === false && window.GARBA_ATMOSPHERE?.active === false, `${name}: pause did not silence normal Atmosphere`);

    if (verifyAutoStop) {
      await test.click();
      await waitFor(page, () => document.querySelector('.atmosphere-test')?.getAttribute('aria-pressed') === 'true', `${name}: auto-stop Test did not start`);
      await waitFor(page, () => document.querySelector('.atmosphere-test')?.getAttribute('aria-pressed') === 'false' && window.GARBA_ATMOSPHERE?.active === false, `${name}: six-second Test did not end automatically`, 8000);
    }

    const reasons = await page.evaluate(() => window.__atmosphereEvents.map((event) => event.reason));
    assert.ok(reasons.includes('mode'), `${name}: mode change event missing`);
    assert.ok(reasons.includes('preview-started'), `${name}: preview-started event missing`);
    assert.ok(reasons.includes('preview-ended'), `${name}: preview-ended event missing`);
    assert.ok(reasons.includes('play'), `${name}: playback handoff event missing`);
    assert.ok(reasons.includes('pause'), `${name}: pause event missing`);

    await page.keyboard.press('Escape');
    await waitFor(page, () => document.querySelector('#atmospherePanel')?.hidden === true, `${name}: Escape did not close panel`);
    assert.equal(await button.getAttribute('aria-expanded'), 'false', `${name}: trigger stayed expanded after close`);
    assert.equal(await page.locator('#app').evaluate((node) => node.hasAttribute('inert')), false, `${name}: app stayed inert after close`);
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'atmosphereButton', `${name}: focus did not return to opener`);

    assert.deepEqual(errors, [], `${name}: browser errors were emitted`);
    console.log(`✓ ${name}: Atmosphere open, viewport, Test, playback handoff, pause and focus restoration passed`);
  } finally {
    await context.close();
    await browser.close();
  }
}

for (const fixture of fixtures) await runFixture(fixture);
console.log('✓ Garba Atmosphere interaction smoke passed in Chromium and WebKit at desktop and phone viewports');
