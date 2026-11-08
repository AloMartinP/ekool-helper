// End-to-end test: real Chromium + the extension + the MCP server over stdio +
// a mock OpenAI-compatible model for the side-panel chat. eKool is mocked by
// serving test/fixture-journal.html at https://test.ekool.eu/.
import { chromium } from 'playwright-core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { readFileSync, readdirSync, mkdtempSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const extPath = join(root, 'extension');
const fixture = readFileSync(join(root, 'test/fixture-journal.html'), 'utf8');
const TOKEN = 'test-token-' + Math.random().toString(36).slice(2);
const PORT = 18765 + Math.floor(Math.random() * 1000);

function chromiumPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const base = join(homedir(), 'Library/Caches/ms-playwright');
  const dir = readdirSync(base).filter((d) => /^chromium-\d+$/.test(d)).sort().pop();
  const mac = join(base, dir, 'chrome-mac-arm64');
  const app = readdirSync(mac).find((f) => f.endsWith('.app'));
  return join(mac, app, 'Contents/MacOS', app.replace(/\.app$/, ''));
}

let pass = 0;
const ok = (name) => {
  pass++;
  console.log('  ✔', name);
};

// ---- mock LLM (OpenAI chat-completions shape) ----
const llmCalls = [];
const llm = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const j = JSON.parse(body);
    llmCalls.push(j);
    const last = j.messages.at(-1);
    const message =
      last.role === 'user'
        ? {
            role: 'assistant',
            content: 'Märgin Kati puudujaks.',
            tool_calls: [
              { id: 'c1', type: 'function', function: { name: 'bulk_set_attendance', arguments: JSON.stringify({ students: ['Kati Mets'], mark: 'P', columns: ['05.11'] }) } },
            ],
          }
        : { role: 'assistant', content: 'Valmis: Kati Mets märgitud puudujaks 05.11.' };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message }] }));
  });
});
await new Promise((r) => llm.listen(0, '127.0.0.1', r));
const llmPort = llm.address().port;

// ---- browser with extension ----
const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'ekh-')), {
  executablePath: chromiumPath(),
  headless: true,
  args: [`--disable-extensions-except=${extPath}`, `--load-extension=${extPath}`],
});
await context.route('https://test.ekool.eu/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: fixture }));
const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
const extId = new URL(sw.url()).host;

// ---- MCP client -> server ----
const mcp = new Client({ name: 'e2e', version: '0' });
await mcp.connect(
  new StdioClientTransport({
    command: process.execPath,
    args: [join(root, 'mcp-server/index.js')],
    env: { ...process.env, EKOOL_HELPER_TOKEN: TOKEN, EKOOL_HELPER_PORT: String(PORT) },
    stderr: 'pipe',
  })
);
const call = async (name, args = {}) => {
  const r = await mcp.callTool({ name, arguments: args });
  const text = r.content[0].text;
  if (r.isError) throw new Error(text);
  return JSON.parse(text);
};

try {
  console.log('MCP');
  const { tools } = await mcp.listTools();
  assert.ok(tools.some((t) => t.name === 'bulk_set_attendance'));
  ok(`lists ${tools.length} tools`);

  await assert.rejects(call('snapshot'), /not connected/);
  ok('clear error when extension is not connected');

  await sw.evaluate(([t, p]) => chrome.storage.local.set({ bridgeToken: t, bridgePort: p }), [TOKEN, PORT]);
  for (let i = 0; i < 50 && (await sw.evaluate(() => globalThis.ekhState.status)) !== 'connected'; i++) await new Promise((r) => setTimeout(r, 200));
  assert.equal(await sw.evaluate(() => globalThis.ekhState.status), 'connected');
  ok('extension connects to MCP bridge with token');

  const page = await context.newPage();
  await page.goto('https://test.ekool.eu/paevik/7b');
  await page.bringToFront();

  const snap = await call('snapshot');
  assert.equal(snap.title, 'Päevik – 7.b matemaatika');
  assert.equal(snap.tables.length, 1);
  assert.deepEqual(snap.tables[0].headers, ['Õpilane', '03.11 / 1. tund', '03.11 / 2. tund', '04.11 / 3. tund', '05.11 / 1. tund']);
  ok('snapshot sees page and merged two-row headers');

  const tbl = await call('read_table');
  const kask = tbl.tables[0].rows.find((r) => r.name.includes('Kask'));
  assert.equal(kask.cells.filter((c) => c.kind === 'select').length, 4);
  assert.equal(kask.cells[2].value, 'H');
  ok('read_table returns pupil rows, refs, values');

  const dry = await call('bulk_set_attendance', { students: ['Mari Tamm', 'Juri Kask', 'Peeter Puu', 'M. Tamm'], mark: 'P', dry_run: true });
  assert.equal(dry.summary.would_set, 4 + 3 + 4);
  assert.equal(dry.summary.skipped_has_value, 1);
  assert.deepEqual(dry.not_found, ['Peeter Puu']);
  assert.equal(await page.$eval('select[name="Tamm, Mari-0"]', (s) => s.value), '');
  ok('dry run: accent/order-insensitive names, "Tamm" ≠ "Tammik", skips existing H, nothing changed');

  const real = await call('bulk_set_attendance', { students: ['Mari Tamm', 'Jüri Kask'], mark: 'P' });
  assert.equal(real.summary.set, 7);
  const vals = await page.$$eval('select', (ss) => Object.fromEntries(ss.map((s) => [s.name, s.value])));
  assert.deepEqual([0, 1, 2, 3].map((i) => vals[`Tamm, Mari-${i}`]), ['P', 'P', 'P', 'P']);
  assert.deepEqual([0, 1, 2, 3].map((i) => vals[`Kask, Jüri-${i}`]), ['P', 'H', 'P', 'P']);
  assert.deepEqual([0, 1, 2, 3].map((i) => vals[`Tammik, Jaan-${i}`]), ['', '', '', '']);
  assert.equal((await page.evaluate(() => window.changeLog)).length, 7);
  ok('fills all lessons for given pupils, fires change events, leaves others alone');

  const col = await call('bulk_set_attendance', { students: ['Liisa Õunapuu'], mark: 'puudus', columns: ['04.11'] });
  assert.equal(col.summary.set, 1);
  assert.equal(await page.$eval('select[name="Õunapuu, Liisa-2"]', (s) => s.value), 'P');
  ok('column filter by date + mark matched by label ("puudus" → P)');

  const bad = await call('bulk_set_attendance', { students: ['Kati Mets'], mark: 'X' });
  assert.equal(bad.summary.errors, 4);
  ok('unknown mark reported with allowed options');

  await call('click', { text: 'Salvesta' });
  assert.equal((await call('wait_for', { text: 'Salvestatud', timeout_ms: 2000 })).found, true);
  ok('click by text + wait_for');

  await assert.rejects(call('navigate', { url: 'https://evil.example.com/' }), /Only https/);
  ok('navigate refuses non-eKool URLs');

  console.log('Side panel AI chat (mock model)');
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extId}/sidepanel.html`);
  await panel.evaluate((p) => chrome.storage.local.set({ provider: 'openai', baseUrl: `http://127.0.0.1:${p}/v1`, model: 'mock', confirmWrites: true }), llmPort);
  await panel.reload();
  await panel.fill('#chat-input', 'Kati Mets puudus 5. novembril');
  await panel.press('#chat-input', 'Enter');
  await panel.getByRole('button', { name: 'Luba', exact: true }).click({ timeout: 10000 });
  await panel.getByText('Valmis: Kati Mets').waitFor({ timeout: 10000 });
  assert.equal(await page.$eval('select[name="Mets, Kati-3"]', (s) => s.value), 'P');
  assert.equal(await page.$eval('select[name="Mets, Kati-0"]', (s) => s.value), '');
  const toolMsg = llmCalls[1].messages.find((m) => m.role === 'tool');
  assert.match(toolMsg.content, /"set":1/);
  assert.equal(llmCalls[0].messages[0].role, 'system');
  ok('chat: model tool call → teacher approves → cell filled → result fed back');

  await panel.fill('#chat-input', 'Kati Mets puudus jälle');
  await panel.press('#chat-input', 'Enter');
  await panel.getByRole('button', { name: 'Keela' }).click({ timeout: 10000 });
  await panel.getByText('Valmis:').nth(1).waitFor({ timeout: 10000 });
  assert.match(llmCalls.at(-1).messages.at(-1).content, /declined/);
  ok('chat: declining a change is reported back to the model');

  console.log('Quick form (no AI)');
  await panel.click('nav button[data-tab=quick]');
  await panel.fill('#q-students', 'Jaan Tammik');
  await panel.fill('#q-columns', '03.11');
  await panel.click('#q-apply');
  await panel.getByText('Täidetud 2 lahtrit').waitFor({ timeout: 5000 });
  assert.deepEqual(await page.$$eval('select[name^="Tammik"]', (ss) => ss.map((s) => s.value)), ['P', 'P', '', '']);
  ok('quick form fills both 03.11 lessons');

  console.log(`\nAll ${pass} checks passed.`);
} finally {
  await mcp.close().catch(() => {});
  await context.close();
  llm.close();
}
