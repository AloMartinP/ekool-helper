# Chrome Web Store listing: eKool Helper

Paste these fields into the developer dashboard (https://chrome.google.com/webstore/devconsole).

## Store listing tab

- **Name** (from manifest): eKool Helper (mitteametlik)
- **Summary** (from manifest, ≤132 chars): Unofficial AI helper for teachers: fills in eKool attendance for many pupils and lessons at once. Not affiliated with eKool.
- **Category:** Education
- **Language:** Estonian (et)
- **Icon:** `extension/icons/icon128.png`
- **Screenshots (1280×800):** `store/assets/screenshot-1-approve.png` … `screenshot-4-settings.png`
- **Small promo tile (440×280):** `store/assets/promo-small-440x280.png`
- **Homepage / support URL:** https://github.com/AloMartinP/ekool-helper

### Description

eKool Helper aitab õpetajal eKooli kiiremini täita. Mitteametlik, ei ole seotud eKooliga.

Mida see teeb
• Puudujad korraga: kirjuta õpilaste nimed ja märge, ning laiendus täidab need kõigis avatud päeviku tundides või ainult valitud kuupäevadel. AI-d pole vaja.
• AI abiline: kirjuta tavakeeles, nt „Mari Tamm ja Jüri Kask puudusid täna". Abiline loeb lehte, näitab, mida muudab, ja küsib enne iga muudatust sinu luba.
• Nimed leitakse ka siis, kui kirjutad ilma täpitähtedeta või teises järjekorras („Juri Kask" = „Kask, Jüri").
• Olemasolevaid märkeid üle ei kirjutata, kui sa seda ise ei luba.
• Midagi ei salvestata ise. Muudatused tõstetakse oranžilt esile ja „Salvesta" vajutad sina.

AI valik
Kasuta oma API võtmega mis tahes OpenAI-ühilduvat teenust (OpenAI, OpenRouter, Ollama või LM Studio sinu arvutis) või Anthropicut. Laiendusel endal servereid pole.

Arendajatele
Sisaldab MCP silda, nii et eKooli saab juhtida ka MCP-toega AI programmidest (eraldi kohalik server, vt kodulehte).

Privaatsus
Õpilaste andmed liiguvad ainult sinu valitud AI teenusele ja ainult siis, kui kasutad AI abilist. Vorm „Puudujad" töötab täielikult brauseris. Kontrolli enne AI kasutamist oma kooli andmekaitsereegleid.

---

English: Unofficial helper that fills in eKool attendance for many pupils across all lessons at once, with an optional AI assistant (bring your own OpenAI-compatible, local or Anthropic model). Asks before every change and never saves on its own. Not affiliated with eKool.

## Privacy practices tab

**Single purpose:** Help teachers fill in the eKool school journal faster, for example by marking the same attendance mark for several pupils across many lessons, either with a form or with an AI assistant.

**Permission justifications:**
- `storage`: Saves the teacher's settings (AI provider, model, API key, MCP token) locally.
- `tabs`: Finds the open ekool.eu tab to work in and opens ekool.eu pages when asked.
- `scripting`: Injects the page helper into an ekool.eu tab that was already open before the extension was installed.
- `sidePanel`: The extension's user interface is a side panel.
- `alarms`: Reconnects the optional local MCP bridge periodically.
- Host `https://*.ekool.eu/*`: Reads and fills in the journal on eKool pages, which is the extension's purpose.
- Hosts `api.openai.com`, `api.anthropic.com`, `openrouter.ai`: Sends the teacher's AI-assistant requests to the AI provider they chose.
- Hosts `localhost` / `127.0.0.1`: Local AI models (Ollama, LM Studio) and the local MCP bridge.
- Optional hosts `https://*/*`, `http://*/*`: Requested at runtime only if the teacher enters a different AI provider address.

**Remote code:** No, I am not using remote code. All JavaScript is packaged in the extension.

**Data usage (check these):**
- ✅ Personally identifiable information: pupil names shown on eKool pages
- ✅ Authentication information: the teacher's own AI API key, stored locally only
- ✅ Website content: eKool page content
- Certify: not sold to third parties; not used for purposes unrelated to the single purpose; not used for creditworthiness or lending.

**Privacy policy URL:** https://alomartinp.github.io/ekool-helper/privacy.html (host `docs/privacy.html`)

## Distribution tab

- **Visibility:** Unlisted (Public / Unlisted / Private)
- **Regions:** Estonia (or all)
- **Pricing:** Free
