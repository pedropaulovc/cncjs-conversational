import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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

// Mimic CNCjs 1.11.5: same-origin parent, token on the iframe URL, its default
// sandbox (no allow-downloads), and a `change` reply to the widget's `connect`.
// `controllers` and `gcode` return those endpoints' bodies (a string is sent as HTML);
// `gate` lets a test hold the controllers reply; `widgetOrigin` serves the widget elsewhere.
const idle = () => [{ port: 'COM7', workflow: { state: 'idle' } }];
const reply = (route, body) => typeof body === 'string'
  ? route.fulfill({ contentType: 'text/html', body })
  : route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
async function embedInCncjs({ controllers = idle, gcode = () => ({}), gate = async () => {}, widgetOrigin = 'http://cncjs.test' } = {}) {
  const html = await readFile(new URL('../web/index.html', import.meta.url), 'utf8');
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const host = await ctx.newPage();
  const uploads = [];
  await ctx.route(/^http:\/\/(cncjs|widget)\.test\//, async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/conversational/') return route.fulfill({ contentType: 'text/html', body: html });
    if (url.pathname === '/api/controllers') {
      await gate();
      return reply(route, controllers());
    }
    if (url.pathname === '/api/gcode') {
      uploads.push({ auth: route.request().headers().authorization, body: route.request().postDataJSON() });
      return reply(route, gcode());
    }
    return route.fulfill({ contentType: 'text/html', body: `<!doctype html><body><iframe name="w"
      sandbox="allow-forms allow-modals allow-popups allow-same-origin allow-scripts"
      style="width:1400px;height:1000px" src="${widgetOrigin}/conversational/?token=tok123"></iframe><script>
      addEventListener('message', e => {
        if (e.data?.token === 'tok123' && e.data.action?.type === 'connect')
          e.source.postMessage({ token: 'tok123', action: { type: 'change', payload: { port: 'COM7', controller: 'Grbl' } } }, '*');
      });</script>` });
  });
  await host.goto('http://cncjs.test/');
  return { ctx, w: host.frameLocator('iframe[name="w"]'), uploads };
}

test('embedded in CNCjs, Load sends the program to /api/gcode', async () => {
  const { ctx, w, uploads } = await embedInCncjs();
  try {
    await w.getByRole('button', { name: 'Circular pocket', exact: true }).click();
    assert.equal(await w.locator('#dl').isHidden(), true);
    await w.getByRole('button', { name: 'Load in CNCjs' }).click();
    await w.getByText('Loaded circ.nc into CNCjs on COM7.').waitFor();
    assert.equal(uploads.length, 1);
    assert.equal(uploads[0].auth, 'Bearer tok123');
    assert.equal(uploads[0].body.port, 'COM7');
    assert.equal(uploads[0].body.name, 'circ.nc');
    assert.match(uploads[0].body.gcode, /^\(Circular pocket[\s\S]*\nM30\n$/);
    // Focus alone keeps the result; changing the program clears it.
    const diameter = w.getByRole('spinbutton', { name: 'Pocket diameter' });
    await diameter.focus();
    await diameter.blur();
    await w.getByText('Loaded circ.nc into CNCjs on COM7.').waitFor();
    await diameter.fill('30');
    await w.getByText('Port COM7: loading replaces the program loaded in CNCjs.').waitFor();
  } finally {
    await ctx.close();
  }
});

test('embedded in CNCjs, Load refuses while a program is running or paused', async () => {
  let state = 'running';
  const { ctx, w, uploads } = await embedInCncjs({ controllers: () => [{ port: 'COM7', workflow: { state } }] });
  try {
    await w.getByRole('button', { name: 'Load in CNCjs' }).click();
    await w.getByText('Not loaded: a program is running on COM7. Stop it in CNCjs first.').waitFor();
    state = 'paused';
    await w.getByRole('button', { name: 'Load in CNCjs' }).click();
    await w.getByText('Not loaded: a program is paused on COM7. Stop it in CNCjs first.').waitFor();
    assert.equal(uploads.length, 0);
  } finally {
    await ctx.close();
  }
});

test('embedded in CNCjs, Load reports a closed port or a reply that is not from CNCjs', async () => {
  let controllers = [], gcode = {};
  const { ctx, w, uploads } = await embedInCncjs({ controllers: () => controllers, gcode: () => gcode });
  const load = async message => {
    await w.getByRole('button', { name: 'Load in CNCjs' }).click();
    await w.getByText(message, { exact: true }).waitFor();
  };
  try {
    await load('Not loaded: COM7 is not open in CNCjs.');
    controllers = [null, 7];
    await load('Not loaded: COM7 is not open in CNCjs.');
    controllers = { msg: 'ok' };
    await load('Not loaded: CNCjs did not report its controllers.');
    controllers = '<!doctype html><title>Sign in</title>';
    await load('Not loaded: CNCjs did not answer /api/controllers.');
    assert.equal(uploads.length, 0);
    // A sign-in page in place of the upload reply must not read as success.
    controllers = idle();
    gcode = '<!doctype html><title>Sign in</title>';
    await load('Not loaded: CNCjs did not answer /api/gcode.');
  } finally {
    await ctx.close();
  }
});

test('embedded in CNCjs, an edit during a load still shows its outcome', async () => {
  let release;
  const held = new Promise(resolve => { release = resolve; });
  const { ctx, w } = await embedInCncjs({ controllers: () => [{ port: 'COM7', workflow: { state: 'running' } }], gate: () => held });
  try {
    await w.getByRole('button', { name: 'Load in CNCjs' }).click();
    await w.getByText('Loading square-setup1.nc…').waitFor();
    await w.getByRole('spinbutton', { name: 'Finished width' }).fill('80');
    release();
    await w.getByText('Not loaded: a program is running on COM7. Stop it in CNCjs first. (This was the program before your last edit.)').waitFor();
    // Back to the program that was sent: its outcome applies again, unmarked.
    await w.getByRole('spinbutton', { name: 'Finished width' }).fill('90');
    await w.getByText('Not loaded: a program is running on COM7. Stop it in CNCjs first.', { exact: true }).waitFor();
    // A program that was never sent clears the outcome.
    await w.getByRole('spinbutton', { name: 'Finished width' }).fill('85');
    await w.getByText('Port COM7: loading replaces the program loaded in CNCjs.').waitFor();
  } finally {
    await ctx.close();
  }
});

test('framed by CNCjs from another origin, Load explains it cannot load', async () => {
  const { ctx, w, uploads } = await embedInCncjs({ widgetOrigin: 'http://widget.test' });
  try {
    await w.getByText('Loading into CNCjs needs the widget served by CNCjs itself (same address and port).').waitFor();
    assert.equal(await w.getByRole('button', { name: 'Load in CNCjs' }).isDisabled(), true);
    assert.equal(await w.locator('#dl').isHidden(), true);
    assert.equal(uploads.length, 0);
  } finally {
    await ctx.close();
  }
});
