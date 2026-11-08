// eKool Helper service worker: routes tool calls (from the side panel AI and from
// the local MCP server over WebSocket) to the eKool tab's content script.

const EKOOL_RE = /^https:\/\/([a-z0-9-]+\.)*ekool\.eu(\/|$)/i;
const isEkool = (url) => EKOOL_RE.test(url || '');
const DEFAULT_PORT = 8765;

let TOOL_DEFS = null;
async function toolDefs() {
  if (!TOOL_DEFS) TOOL_DEFS = await (await fetch(chrome.runtime.getURL('tools.json'))).json();
  return TOOL_DEFS;
}

// ---------- tabs ----------
async function findTab(tabId) {
  if (tabId) {
    const t = await chrome.tabs.get(tabId);
    if (!isEkool(t.url)) throw new Error(`Tab ${tabId} is not an eKool page`);
    return t;
  }
  const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (active && isEkool(active.url)) return active;
  const all = (await chrome.tabs.query({})).filter((t) => isEkool(t.url));
  if (!all.length) throw new Error('No eKool tab is open. Open https://ekool.eu and log in first (or use navigate).');
  return all.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
}

function waitForLoad(tabId, timeout = 20000) {
  return new Promise((resolve) => {
    const done = () => {
      chrome.tabs.onUpdated.removeListener(onUpd);
      clearTimeout(timer);
      resolve();
    };
    const onUpd = (id, info) => {
      if (id === tabId && info.status === 'complete') done();
    };
    const timer = setTimeout(done, timeout);
    chrome.tabs.onUpdated.addListener(onUpd);
  });
}

async function sendToTab(tab, tool, args) {
  const send = () => chrome.tabs.sendMessage(tab.id, { type: 'ekh-tool', tool, args }, { frameId: 0 });
  let resp;
  try {
    resp = await send();
  } catch (e) {
    if (!/Receiving end does not exist|Could not establish connection/i.test(String(e?.message))) throw e;
    // Tab was open before the extension was installed/reloaded: inject now.
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    resp = await send();
  }
  if (!resp) throw new Error('No response from the eKool page');
  if (!resp.ok) throw new Error(resp.error);
  return resp.result;
}

const BG_TOOLS = {
  async list_tabs() {
    const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const tabs = (await chrome.tabs.query({})).filter((t) => isEkool(t.url));
    return tabs.map((t) => ({ id: t.id, title: t.title, url: t.url, active: t.id === active?.id }));
  },
  async navigate({ url, tabId }) {
    if (!isEkool(url)) throw new Error('Only https://…ekool.eu addresses can be opened.');
    let tab;
    try {
      tab = await findTab(tabId);
    } catch {
      tab = await chrome.tabs.create({ url, active: true });
      await waitForLoad(tab.id);
      return { url, tabId: tab.id };
    }
    const sameDoc = tab.url.split('#')[0] === url.split('#')[0];
    const loaded = sameDoc ? null : waitForLoad(tab.id);
    await chrome.tabs.update(tab.id, { url });
    if (loaded) await loaded;
    else await new Promise((r) => setTimeout(r, 800)); // SPA hash route
    const t = await chrome.tabs.get(tab.id);
    return { url: t.url, title: t.title, tabId: t.id };
  },
};

export async function runTool(name, args = {}) {
  const defs = await toolDefs();
  if (!defs.some((d) => d.name === name)) throw new Error(`Unknown tool ${name}`);
  if (BG_TOOLS[name]) return BG_TOOLS[name](args);
  const tab = await findTab(args.tabId);
  const { tabId, ...rest } = args;
  return sendToTab(tab, name, rest);
}

// ---------- MCP bridge (WebSocket to local MCP server) ----------
const state = { status: 'disconnected', detail: '' };
globalThis.ekhState = state;
let ws = null;

function setStatus(status, detail = '') {
  state.status = status;
  state.detail = detail;
  chrome.runtime.sendMessage({ type: 'ekh-status', ...state }).catch(() => {});
}

async function connect(force = false) {
  const { bridgeToken, bridgePort = DEFAULT_PORT, bridgeEnabled = true } = await chrome.storage.local.get([
    'bridgeToken',
    'bridgePort',
    'bridgeEnabled',
  ]);
  if (force && ws) {
    ws.onclose = null;
    ws.close();
    ws = null;
  }
  if (!bridgeEnabled) return setStatus('off', 'MCP bridge turned off');
  if (!bridgeToken) return setStatus('no-token', 'Paste the token from the MCP server into settings');
  if (ws && ws.readyState <= 1) return;
  setStatus('connecting');
  const sock = new WebSocket(`ws://127.0.0.1:${bridgePort}/?token=${encodeURIComponent(bridgeToken)}`);
  ws = sock;
  sock.onopen = () => {
    setStatus('connected', `127.0.0.1:${bridgePort}`);
    sock.send(JSON.stringify({ type: 'hello', version: chrome.runtime.getManifest().version }));
  };
  sock.onmessage = async (ev) => {
    let m;
    try {
      m = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (m.type !== 'call') return;
    try {
      const result = await runTool(m.tool, m.args || {});
      sock.send(JSON.stringify({ type: 'result', id: m.id, result }));
    } catch (e) {
      sock.send(JSON.stringify({ type: 'result', id: m.id, error: String(e?.message || e) }));
    }
  };
  sock.onclose = () => {
    if (ws === sock) ws = null;
    setStatus('disconnected', 'MCP server not running (start it from your AI client)');
  };
  sock.onerror = () => {};
}

// Keepalive: WebSocket traffic every 20 s keeps the MV3 worker alive while connected.
setInterval(() => {
  if (ws?.readyState === 1) ws.send('{"type":"ping"}');
  else connect();
}, 20000);
chrome.alarms.create('ekh-reconnect', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((a) => a.name === 'ekh-reconnect' && connect());
chrome.storage.onChanged.addListener((changes) => {
  if (changes.bridgeToken || changes.bridgePort || changes.bridgeEnabled) connect(true);
});
chrome.runtime.onStartup.addListener(() => connect());
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  connect();
});
connect();

// ---------- side panel API ----------
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'ekh-run-tool') {
    runTool(msg.tool, msg.args || {}).then(
      (result) => sendResponse({ ok: true, result }),
      (e) => sendResponse({ ok: false, error: String(e?.message || e) })
    );
    return true;
  }
  if (msg?.type === 'ekh-get-status') {
    sendResponse({ ...state });
    return false;
  }
  if (msg?.type === 'ekh-get-tools') {
    toolDefs().then((d) => sendResponse(d));
    return true;
  }
});
