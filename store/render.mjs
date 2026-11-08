// Renders Chrome Web Store assets: extension icons, 1280x800 screenshots, 440x280 promo tile.
// Uses the same mock journal + mock model as the e2e test, so screenshots show real UI.
import { chromium } from 'playwright-core';
import { readFileSync, readdirSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const extPath = join(root, 'extension');
const out = join(root, 'store/assets');
mkdirSync(out, { recursive: true });
const svg = readFileSync(join(root, 'store/icon.svg'), 'utf8');
const fixture = readFileSync(join(root, 'test/fixture-journal.html'), 'utf8');

function chromiumPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const base = join(homedir(), 'Library/Caches/ms-playwright');
  const dir = readdirSync(base).filter((d) => /^chromium-\d+$/.test(d)).sort().pop();
  const mac = join(base, dir, 'chrome-mac-arm64');
  const app = readdirSync(mac).find((f) => f.endsWith('.app'));
  return join(mac, app, 'Contents/MacOS', app.replace(/\.app$/, ''));
}

// Mock model: one tool call, then a summary.
const llm = http.createServer((req, res) => {
  let b = '';
  req.on('data', (c) => (b += c));
  req.on('end', () => {
    const last = JSON.parse(b).messages.at(-1);
    const message =
      last.role === 'user'
        ? {
            role: 'assistant',
            content: 'Leidsin päevikust Mari Tamme ja Jüri Kase. Märgin nad kõigis tundides puudujaks.',
            tool_calls: [{ id: 'c1', type: 'function', function: { name: 'bulk_set_attendance', arguments: JSON.stringify({ students: ['Mari Tamm', 'Jüri Kask'], mark: 'P' }) } }],
          }
        : {
            role: 'assistant',
            content:
              'Valmis. Märkisin 7 lahtrit:\n• Mari Tamm – P kõigis 4 tunnis\n• Jüri Kask – P 3 tunnis (03.11 2. tunnis oli juba „H", jätsin alles)\n\nMuudatused on oranžilt esile tõstetud. Kontrolli üle ja vajuta „Salvesta".',
          };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message }] }));
  });
});
await new Promise((r) => llm.listen(0, '127.0.0.1', r));

const browser = await chromium.launch({ executablePath: chromiumPath(), headless: true });

// ---- icons ----
const ip = await browser.newPage();
for (const s of [16, 32, 48, 128]) {
  await ip.setViewportSize({ width: s, height: s });
  await ip.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${s}" height="${s}" `)}</body></html>`);
  await ip.screenshot({ path: join(extPath, `icons/icon${s}.png`), omitBackground: true });
}
await browser.close();

// ---- extension UI ----
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'ekh-')), {
  executablePath: chromiumPath(),
  headless: true,
  args: [`--disable-extensions-except=${extPath}`, `--load-extension=${extPath}`],
  viewport: { width: 880, height: 800 },
  deviceScaleFactor: 1,
});
await ctx.route('https://test.ekool.eu/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: fixture }));
const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
const extId = new URL(sw.url()).host;

const journal = await ctx.newPage();
await journal.goto('https://test.ekool.eu/paevik/7b');
const panel = await ctx.newPage();
await panel.setViewportSize({ width: 400, height: 800 });
await panel.goto(`chrome-extension://${extId}/sidepanel.html`);
await panel.evaluate(
  (p) => chrome.storage.local.set({ provider: 'openai', baseUrl: `http://127.0.0.1:${p}/v1`, model: 'demo', confirmWrites: true, bridgeEnabled: false }),
  llm.address().port
);
await panel.reload();

async function compose(name, title) {
  const j = (await journal.screenshot()).toString('base64');
  const p = (await panel.screenshot()).toString('base64');
  const c = await ctx.newPage();
  await c.setViewportSize({ width: 1280, height: 800 });
  await c.setContent(`<html><body style="margin:0;display:flex;background:#d0d7de;font:600 13px system-ui">
    <img src="data:image/png;base64,${j}" style="width:880px;height:800px">
    <img src="data:image/png;base64,${p}" style="width:399px;height:800px;margin-left:1px">
    ${title ? `<div style="position:absolute;left:24px;bottom:20px;background:#0b4fa3;color:#fff;padding:8px 14px;border-radius:8px">${title}</div>` : ''}
  </body></html>`);
  await c.screenshot({ path: join(out, name) });
  await c.close();
}

// 1: chat asks for approval
await panel.fill('#chat-input', 'Mari Tamm ja Jüri Kask puudusid täna kõigis tundides');
await panel.press('#chat-input', 'Enter');
await panel.getByRole('button', { name: 'Luba', exact: true }).waitFor();
await compose('screenshot-1-approve.png', 'Kirjuta, mida teha – abiline küsib enne muutmist luba');

// 2: done, cells highlighted
await panel.getByRole('button', { name: 'Luba', exact: true }).click();
await panel.getByText('Valmis. Märkisin').waitFor();
await compose('screenshot-2-done.png', 'Kõik tunnid täidetud – sina kontrollid ja salvestad');

// 3: quick form without AI
await journal.reload();
await panel.click('nav button[data-tab=quick]');
await panel.fill('#q-students', 'Kati Mets\nLiisa Õunapuu\nPeeter Puu');
await panel.fill('#q-columns', '03.11');
await panel.click('#q-preview');
await panel.getByText('Eelvaade:').waitFor();
await compose('screenshot-3-quick.png', 'Puudujad ilma AI-ta: nimed sisse, eelvaade, täida');

// 4: settings
await panel.click('nav button[data-tab=settings]');
await compose('screenshot-4-settings.png', 'Vali oma AI: OpenAI-ühilduv, Ollama (kohalik) või Anthropic. MCP tugi.');

// ---- promo tile 440x280 ----
const t = await ctx.newPage();
await t.setViewportSize({ width: 440, height: 280 });
await t.setContent(`<html><body style="margin:0;width:440px;height:280px;background:linear-gradient(135deg,#1f7ae0,#0b4fa3);color:#fff;font-family:system-ui;display:flex;align-items:center;gap:22px;padding:0 30px;box-sizing:border-box">
  <div style="width:110px;height:110px;flex:none">${svg.replace('<svg ', '<svg width="110" height="110" ').replace(/fill="url\(#g\)"/, 'fill="#ffffff22"')}</div>
  <div><div style="font-size:30px;font-weight:700;line-height:1.1">eKool Helper</div>
  <div style="font-size:16px;margin-top:8px;opacity:.92">AI täidab puudumised kõigis tundides korraga</div></div></body></html>`);
await t.screenshot({ path: join(out, 'promo-small-440x280.png') });

await ctx.close();
llm.close();
console.log('assets written to', out);
