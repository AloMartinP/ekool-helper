# eKool Helper

A Chrome extension that helps teachers fill in **eKool** (ekool.eu) using AI. It also has an **MCP server**, so any MCP-capable AI client (Claude Desktop/Code, Cursor, VS Code, LM Studio, …) can drive eKool in your browser.

Example: *"Mari Tamm and Jüri Kask were absent all of today"* → it finds both pupils in the journal and fills the absence mark in every lesson. Then it **leaves the changes on screen for you to check and save**.

## What's inside

| Part | What it does |
|---|---|
| `extension/content.js` | Runs on `*.ekool.eu`. Reads tables and grids, finds pupils by name (ignores accents and name order, so "Kask Jüri" = "Juri Kask"), fills selects and inputs, and fires the events eKool's framework listens for. Every changed cell gets an orange outline. |
| `extension/background.js` | Sends tool calls from the side panel and from the MCP bridge to the eKool tab. Only opens `ekool.eu` URLs. |
| Side panel → **AI abiline** | Chat with an AI model that uses the tools. Before any change it asks you to approve (Luba / Keela). |
| Side panel → **Puudujad** | No AI needed: paste pupil names, pick a mark and optional date/lesson columns, then click **Eelvaade** (preview) or **Täida** (fill). |
| `mcp-server/` | A stdio MCP server that exposes the same 9 tools. The extension connects to it over `ws://127.0.0.1:8765` using a token. |

Tools: `snapshot`, `read_table`, `bulk_set_attendance`, `click`, `fill`, `select_option`, `wait_for`, `navigate`, `list_tabs` (defined once in `extension/tools.json`).

## Install

```bash
npm install
```

1. In Chrome, open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and choose the `extension/` folder.
2. Click the toolbar icon to open the side panel.
3. **Seaded** (Settings): pick an AI provider. Any OpenAI-compatible API works, for example OpenAI, OpenRouter, or a local Ollama/LM Studio at `http://localhost:11434/v1`. Anthropic works too. Enter the model and the API key. Keys stay in `chrome.storage.local` on this computer and are sent only to the provider you pick.

### MCP (optional)

Add the server to your AI client's MCP config:

```json
{
  "mcpServers": {
    "ekool": { "command": "node", "args": ["/path/to/ekool-helper/mcp-server/index.js"] }
  }
}
```

Print the token, then paste it into the side panel's **Seaded → MCP sild → Võti** field:

```bash
npm run token
```

The token is created once and stored in `~/.ekool-helper/token`. Once connected, the pill at the top of the panel shows **MCP: ühendatud**. Environment overrides: `EKOOL_HELPER_PORT`, `EKOOL_HELPER_TOKEN`.

## Safety

- The bridge accepts only `chrome-extension://` origins that send the right token. A web page trying to reach localhost gets 403, and a wrong token gets 401 (both tested).
- Nothing gets saved on its own. The tools change the form only, and the AI is told not to click Salvesta/Saada/Kustuta unless you ask.
- `navigate` is limited to `https://*.ekool.eu`.
- The AI treats page content as data, not as instructions.

## Test

```bash
npm test
```

The test runs real Chromium with the extension loaded and uses a mock eKool journal (`test/fixture-journal.html`, served at `https://test.ekool.eu/`). It covers MCP client → server → extension → page, the side-panel chat against a mock OpenAI-compatible model (approve and decline), and the quick form. 14 checks.

## Limits / next steps

- **Not yet tried against the real eKool.** The DOM logic is generic (tables, ARIA grids, selects, inputs, same-origin iframes) and has only run against the mock page. If real eKool attendance cells open a popup instead of being plain inputs, `bulk_set_attendance` reports them as skipped. The AI can still do them with `click` → `snapshot` → `select_option`, but slower. The next step is to record one real lesson page and add a dedicated handler.
- The attendance code (default `P`) is a guess. Use whatever your school's eKool shows; the code is matched against both the option value and the label.
- Ollama may reject the extension origin with 403. In that case start it with `OLLAMA_ORIGINS=chrome-extension://*`.
- When the MCP server isn't running, Chrome's extension page logs a connection error every 30 s. This is harmless; you can turn the bridge off in settings.
