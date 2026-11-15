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

test('switching units converts typed values, takes the other defaults, and writes G20 or G21', async () => {
  const p = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  try {
    await p.goto(page_url);
    await p.getByRole('button', { name: 'Face', exact: true }).click();
    await p.getByRole('spinbutton', { name: 'Stock width along X' }).fill('120');
    await p.getByRole('button', { name: 'inch', exact: true }).click();
    assert.equal(await p.getByRole('spinbutton', { name: 'Stock width along X' }).inputValue(), '4.7244');
    assert.equal(await p.getByRole('spinbutton', { name: 'Stock height along Y' }).inputValue(), '2.5');
    assert.match(await p.locator('#v-tool').innerText(), /in\/min/);
    let code = await p.locator('#gcode').innerText();
    assert.match(code, /^G20 G90 G17 G94$/m);
    assert.doesNotMatch(code, /G21/);
    // passes overrun the 4.7244 in stock by the tool radius and 0.08 in, not 2 (mm)
    const xs = code.split('\n').flatMap(l => words(l, 'X'));
    assert.ok(Math.max(...xs) < 4.7244 + 0.125 + 0.08 + 1e-4, `X${Math.max(...xs)} overruns as if in mm`);
    await p.getByRole('button', { name: 'mm', exact: true }).click();
    assert.equal(await p.getByRole('spinbutton', { name: 'Stock width along X' }).inputValue(), '120');
    assert.equal(await p.getByRole('spinbutton', { name: 'Stock height along Y' }).inputValue(), '60');
    code = await p.locator('#gcode').innerText();
    assert.match(code, /^G21 G90 G17 G94$/m);
  } finally {
    await p.close();
  }
});

// As the sidebar column shows it: no dimension box may cover another or hang outside its
// sketch, none may stray far from the dimension it sets, and nothing may scroll sideways.
// Each case starts from a fresh page; besides every operation's defaults it covers thin stock
// and features near the stock's edges.
// past this a misplaced anchor or an overcrowded sketch has pushed a box away from its dimension
const MAX_STRAY = 24;
test('at CNCjs sidebar width, dimension boxes stay apart, near their dimensions and inside their sketches', async () => {
  const cases = [
    ['Square up stock', '1: face top, cut sides'], ['Square up stock', '2: flip, face to thickness'],
    ['Face'], ['Side face', 'Front (Y−)'], ['Side face', 'Back (Y+)'], ['Side face', 'Left (X−)'], ['Side face', 'Right (X+)'],
    ['Rectangular pocket'], ['Circular pocket'], ['Bolt circle'],
    ['Rectangular pocket', null, { 'Stock thickness': 8, 'Pocket depth': 3 }],
    ['Circular pocket', null, { 'Stock thickness': 3, 'Pocket depth': 1 }],
    ['Bolt circle', null, { 'Stock thickness': 6, 'Hole depth to drill tip': 4 }],
    ['Bolt circle', null, { 'Bolt circle centre Y': 40 }],
    ['Rectangular pocket', null, { 'Pocket centre X': 60, 'Pocket centre Y': 15, 'Pocket width': 50, 'Pocket length': 20 }],
    ['Rectangular pocket', null, { 'Pocket centre X': 30, 'Pocket centre Y': 13, 'Pocket width': 40, 'Pocket length': 20 }],
    ['Side face', 'Left (X−)', { 'Stock thickness': 5, 'Side depth below Z0': 4 }],
  ];
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  try {
    for (const [op, variant, values = {}] of cases) {
      const p = await ctx.newPage();
      const pageErrors = [];
      p.on('pageerror', e => pageErrors.push(e.message));
      await p.goto(page_url);
      await p.getByRole('button', { name: op, exact: true }).click();
      if (variant) await p.getByRole('button', { name: variant }).click();
      for (const [name, value] of Object.entries(values)) await p.getByRole('spinbutton', { name, exact: true }).fill(String(value));
      const problems = await p.evaluate(maxStray => {
        const out = [];
        const doc = document.documentElement;
        if (doc.scrollWidth > doc.clientWidth) out.push(`page scrolls sideways (${doc.scrollWidth} > ${doc.clientWidth})`);
        const boxes = [...document.querySelectorAll('.fld:not([hidden])')].map(el => ({
          el, name: el.querySelector('input').getAttribute('aria-label'), r: el.getBoundingClientRect(), v: el.closest('.view').getBoundingClientRect(),
        }));
        for (const { el, name, r, v } of boxes) {
          if (r.left < v.left - 0.5 || r.right > v.right + 0.5 || r.top < v.top - 0.5 || r.bottom > v.bottom + 0.5) out.push(`${name} leaves its sketch`);
          const ov = el.parentNode.getBoundingClientRect();
          const ax = ov.left + +el.dataset.ax, ay = ov.top + +el.dataset.ay;
          const stray = Math.hypot(Math.max(r.left - ax, 0, ax - r.right), Math.max(r.top - ay, 0, ay - r.bottom));
          if (stray > maxStray) out.push(`${name} is ${Math.round(stray)} px from its dimension`);
        }
        boxes.forEach((a, i) => boxes.slice(i + 1).forEach(b => {
          if (a.r.left < b.r.right && b.r.left < a.r.right && a.r.top < b.r.bottom && b.r.top < a.r.bottom) out.push(`${a.name} covers ${b.name}`);
        }));
        return out;
      }, MAX_STRAY);
      assert.deepEqual([...pageErrors, ...problems], [], `${[op, variant].filter(Boolean).join(' / ')} ${JSON.stringify(values)}`);
      await p.close();
    }
  } finally {
    await ctx.close();
  }
});

// Committing stock H fires `change` on the mousedown of the next click; the plan refit it
// triggers must not move the clicked button out from under the mouseup.
test('committing a stock size by clicking a button below the plan still clicks that button', async () => {
  const p = await browser.newPage({ viewport: { width: 1440, height: 1400 } });
  try {
    await p.goto(page_url);
    await p.getByRole('button', { name: 'Face', exact: true }).click();
    await p.getByRole('spinbutton', { name: 'Stock height along Y', exact: true }).fill('140');
    const download = p.waitForEvent('download', { timeout: 2000 });
    await p.locator('#dl').click();
    assert.equal((await download).suggestedFilename(), 'face.nc');
    assert.ok(await p.locator('#v-plan').evaluate(el => el.getBoundingClientRect().height > 200), 'plan was not refitted to the taller stock');
  } finally {
    await p.close();
  }
});

// Mimic CNCjs 1.11.5: same-origin parent with its stylesheet, a sidebar-wide iframe with the
// token on its URL, its default sandbox (no allow-downloads), and a `change` reply to the
// widget's `connect`. `controllers` and `gcode` return those endpoints' bodies (a string is
// sent as HTML); `gate` lets a test hold the controllers reply; `widgetOrigin` serves the widget
// elsewhere; `css` is CNCjs's stylesheet, or null for one that fails to load.
const idle = () => [{ port: 'COM7', workflow: { state: 'idle' } }];
const reply = (route, body) => typeof body === 'string'
  ? route.fulfill({ contentType: 'text/html', body })
  : route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
// Stands in for CNCjs's main.css: its page minimum width and a recognisable Bootstrap colour.
const CNCJS_CSS = 'body{min-width:960px}.btn-primary{background-color:rgb(1, 2, 3)}';
async function embedInCncjs({ controllers = idle, gcode = () => ({}), gate = async () => {}, widgetOrigin = 'http://cncjs.test', css = CNCJS_CSS } = {}) {
  const html = await readFile(new URL('../web/index.html', import.meta.url), 'utf8');
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const consoleLines = [];
  ctx.on('console', m => consoleLines.push(m.text()));
  const host = await ctx.newPage();
  const uploads = [];
  await ctx.route(/^http:\/\/(cncjs|widget)\.test\//, async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/conversational/') return route.fulfill({ contentType: 'text/html', body: html });
    if (url.pathname === '/main.css') return css === null ? route.fulfill({ status: 404, body: '' }) : route.fulfill({ contentType: 'text/css', body: css });
    if (url.pathname === '/api/controllers') {
      await gate();
      return reply(route, controllers());
    }
    if (url.pathname === '/api/gcode') {
      uploads.push({ auth: route.request().headers().authorization, body: route.request().postDataJSON() });
      return reply(route, gcode());
    }
    return route.fulfill({ contentType: 'text/html', body: `<!doctype html><head><link rel="stylesheet" href="/main.css"></head><body><iframe name="w"
      sandbox="allow-forms allow-modals allow-popups allow-same-origin allow-scripts"
      style="width:338px;height:1000px" src="${widgetOrigin}/conversational/?token=tok123"></iframe><script>
      addEventListener('message', e => {
        if (e.data?.token === 'tok123' && e.data.action?.type === 'connect')
          e.source.postMessage({ token: 'tok123', action: { type: 'change', payload: { port: 'COM7', controller: 'Grbl' } } }, '*');
      });</script>` });
  });
  await host.goto('http://cncjs.test/');
  return { ctx, w: host.frameLocator('iframe[name="w"]'), uploads, consoleLines };
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

test('embedded in CNCjs, a CNCjs stylesheet that fails to load keeps the stand-in styles', async () => {
  const { ctx, w, consoleLines } = await embedInCncjs({ css: null });
  try {
    for (let i = 0; i < 100 && !consoleLines.some(l => l.includes('keeping the stand-in')); i++) await new Promise(r => setTimeout(r, 50));
    assert.ok(consoleLines.some(l => l.includes('keeping the stand-in')), 'no warning about the failed stylesheet');
    assert.equal(await w.locator('#cncjs-fallback').count(), 1);
    const load = w.getByRole('button', { name: 'Load in CNCjs' });
    assert.equal(await load.evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(51, 122, 183)');
  } finally {
    await ctx.close();
  }
});

test('embedded in CNCjs, the widget wears CNCjs stylesheet and fits the sidebar', async () => {
  const { ctx, w } = await embedInCncjs();
  try {
    const load = w.getByRole('button', { name: 'Load in CNCjs' });
    await w.locator('#cncjs-fallback').waitFor({ state: 'detached' });
    assert.equal(await load.evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(1, 2, 3)');
    assert.equal(await load.evaluate(el => el.ownerDocument.documentElement.scrollWidth <= el.ownerDocument.documentElement.clientWidth), true);
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

const grbl = units => [{ port: 'COM7', workflow: { state: 'idle' }, controller: { type: 'Grbl', state: { parserstate: { modal: { units } } } } }];

test('embedded in CNCjs, the first units report sets the widget up with that unit\'s defaults', async () => {
  const { ctx, w } = await embedInCncjs({ controllers: () => grbl('G20') });
  try {
    await w.getByText('G20, as set on COM7').waitFor();
    assert.equal(await w.getByRole('button', { name: 'mm', exact: true }).isDisabled(), true);
    assert.match(await w.locator('#gcode').innerText(), /^G20 G90 G17 G94$/m);
    assert.equal(await w.getByRole('spinbutton', { name: 'Stock width along X' }).inputValue(), '4');
  } finally {
    await ctx.close();
  }
});

test('embedded in CNCjs, later machine switches keep the part\'s size, Load included', async () => {
  let units = 'G21';
  const { ctx, w, uploads } = await embedInCncjs({ controllers: () => grbl(units) });
  const width = w.getByRole('spinbutton', { name: 'Stock width along X' });
  try {
    await w.getByText('G21, as set on COM7').waitFor();
    // G20 typed into CNCjs's console: converted (3.937 in), not the inch default (4 in)
    units = 'G20';
    await w.getByText('G20, as set on COM7').waitFor();
    assert.equal(await width.inputValue(), '3.937');
    units = 'G21';
    await w.getByText('G21, as set on COM7').waitFor();
    assert.equal(await width.inputValue(), '100');
    // converted from the value as entered, not the rounded 0.1969 in: no drift to 5.001
    assert.equal(await w.getByRole('spinbutton', { name: 'Clearance height above Z0' }).inputValue(), '5');
    // G20 sent while the tab is hidden (no polls), then Load: Load sees it and regenerates the
    // same part in inches
    const frame = ctx.pages()[0].frame({ name: 'w' });
    await frame.evaluate(() => Object.defineProperty(document, 'hidden', { get: () => true, configurable: true }));
    await new Promise(resolve => setTimeout(resolve, 1200));
    units = 'G20';
    await w.getByRole('button', { name: 'Load in CNCjs' }).click();
    await w.getByText('Loaded square-setup1.nc into CNCjs on COM7 in inches: COM7 switched to G20.').waitFor();
    assert.equal(uploads.length, 1);
    assert.match(uploads[0].body.gcode, /\n\(stock 3\.937 x 2\.3622 x 0\.7874, /);
    assert.match(uploads[0].body.gcode, /\nG20 G90 G17 G94\n/);
    assert.doesNotMatch(uploads[0].body.gcode, /G21/);
    assert.equal(await w.locator('#gcode').innerText().then(t => t + '\n'), uploads[0].body.gcode);
  } finally {
    await ctx.close();
  }
});

test('embedded in CNCjs, Load refuses a units switch when the program changed while it waited', async () => {
  let units = 'G21', hold = null, release;
  const { ctx, w, uploads } = await embedInCncjs({ controllers: () => grbl(units), gate: () => hold });
  try {
    await w.getByText('G21, as set on COM7').waitFor();
    hold = new Promise(resolve => { release = resolve; });
    await w.getByRole('button', { name: 'Load in CNCjs' }).click();
    await w.getByText('Loading square-setup1.nc…').waitFor();
    await w.getByRole('spinbutton', { name: 'Finished width' }).fill('80');
    units = 'G20';
    release();
    await w.getByText('Not loaded: COM7 is in G20 and the program changed while loading. It is now shown in inches; check it and load again.').waitFor();
    assert.equal(uploads.length, 0);
    // the edit is kept, converted, and what is shown is what the next Load sends; the user is
    // still in the box they were typing in
    const finished = w.getByRole('spinbutton', { name: 'Finished width' });
    assert.equal(await finished.inputValue(), '3.1496');
    assert.equal(await finished.evaluate(el => el === document.activeElement), true);
    assert.match(await w.locator('#gcode').innerText(), /^G20 G90 G17 G94$/m);
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
