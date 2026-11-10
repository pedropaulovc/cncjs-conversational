import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const page_url = pathToFileURL(fileURLToPath(new URL('../web/index.html', import.meta.url))).href;
let browser, page;
const errors = [];

before(async () => {
  browser = await chromium.launch({ channel: process.env.PW_CHANNEL });
  page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(page_url);
});
after(() => browser?.close());

const gcode = () => page.locator('#gcode').innerText();
const words = (line, letter) => [...line.matchAll(new RegExp(`${letter}(-?[\\d.]+)`, 'g'))].map(m => +m[1]);

for (const op of ['Square up stock', 'Face', 'Side face', 'Rectangular pocket', 'Circular pocket', 'Bolt circle']) {
  test(`${op} defaults produce a complete program`, async () => {
    await page.getByRole('button', { name: op, exact: true }).click();
    const code = (await gcode()).trim().split('\n');
    assert.deepEqual(errors, []);
    assert.equal(code.at(-1), 'M30');
    assert.equal(await page.locator('#checks li[data-lv="error"]').count(), 0);
  });
}

test('side face on Y− stays within the band it removes', async () => {
  await page.getByRole('button', { name: 'Side face', exact: true }).click();
  await page.getByRole('button', { name: 'Front (Y−)' }).click();
  await page.getByRole('spinbutton', { name: 'Material to remove from the side' }).fill('4');
  await page.getByRole('spinbutton', { name: 'Side depth below Z0' }).fill('7');
  const code = (await gcode()).split('\n');
  const toolR = 6.35 / 2;
  const ys = code.flatMap(l => words(l, 'Y'));
  assert.ok(ys.length > 0);
  for (const y of ys) assert.ok(y >= -toolR - 1e-3 && y <= 4 - toolR + 1e-3, `Y${y} outside the 4 mm band`);
  const zs = code.filter(l => l.startsWith('G1 Z')).flatMap(l => words(l, 'Z'));
  assert.equal(Math.min(...zs), -7);
  // finishing pass leaves the face exactly 4 mm in
  assert.ok(ys.some(y => Math.abs(y - (4 - toolR)) < 1e-3));
});

test('side face refuses a cut deeper than the stock', async () => {
  await page.getByRole('button', { name: 'Side face', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Side depth below Z0' }).fill('25');
  assert.match(await page.locator('#checks').innerText(), /deeper than the stock/);
  assert.equal(await page.locator('#dl').isDisabled(), true);
});
