// eKool Helper content script: DOM tools that run inside the eKool page.
// Generic by design: eKool's markup changes, so tools work on tables/grids and
// form controls rather than on hard-coded selectors.
(() => {
  if (window.__ekoolHelperLoaded) return;
  window.__ekoolHelperLoaded = true;

  const REF_ATTR = 'data-ekh-ref';
  let refCounter = 0;

  const norm = (s) =>
    String(s ?? '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  const tokens = (s) => norm(s).split(/[\s,.;:()\-]+/).filter(Boolean);
  const clip = (s, n = 80) => {
    s = String(s ?? '').replace(/\s+/g, ' ').trim();
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  };

  // Top document plus same-origin iframes (eKool has used frames in places).
  function docs() {
    const out = [];
    const walk = (d) => {
      out.push(d);
      for (const f of d.querySelectorAll('iframe,frame')) {
        try {
          if (f.contentDocument) walk(f.contentDocument);
        } catch {
          /* cross-origin frame: skip */
        }
      }
    };
    walk(document);
    return out;
  }
  const qsaAll = (sel) => docs().flatMap((d) => [...d.querySelectorAll(sel)]);

  function refOf(el) {
    let r = el.getAttribute(REF_ATTR);
    if (!r) {
      r = 'e' + ++refCounter;
      el.setAttribute(REF_ATTR, r);
    }
    return r;
  }
  function byRef(ref) {
    for (const d of docs()) {
      const el = d.querySelector(`[${REF_ATTR}="${CSS.escape(ref)}"]`);
      if (el) return el;
    }
    throw new Error(`No element with ref "${ref}". Take a new snapshot; the page may have changed.`);
  }

  function visible(el) {
    if (!el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const cs = el.ownerDocument.defaultView.getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none';
  }

  function labelOf(el) {
    const aria = el.getAttribute('aria-label');
    if (aria) return clip(aria);
    const lb = el.getAttribute('aria-labelledby');
    if (lb) {
      const t = lb
        .split(/\s+/)
        .map((id) => el.ownerDocument.getElementById(id)?.innerText || '')
        .join(' ');
      if (t.trim()) return clip(t);
    }
    if (el.labels && el.labels.length) return clip([...el.labels].map((l) => l.innerText).join(' '));
    for (const a of ['placeholder', 'title', 'alt', 'name']) {
      const v = el.getAttribute(a);
      if (v) return clip(v);
    }
    if (el.tagName === 'INPUT' && ['button', 'submit'].includes(el.type)) return clip(el.value);
    return clip(el.innerText || el.textContent);
  }

  // ---------- controls ----------
  const CONTROL_SEL =
    'select, textarea, input:not([type=hidden]):not([type=button]):not([type=submit]):not([type=reset]):not([type=image]), [contenteditable=""], [contenteditable=true], [role=checkbox], [role=combobox], [role=textbox]';
  const INTERACTIVE_SEL =
    CONTROL_SEL +
    ', a[href], button, input[type=button], input[type=submit], [role=button], [role=link], [role=tab], [role=menuitem], [role=option], [onclick], [tabindex]:not([tabindex="-1"])';

  function controlKind(el) {
    const t = el.tagName;
    if (t === 'SELECT') return 'select';
    if (t === 'TEXTAREA') return 'text';
    if (t === 'INPUT') {
      if (el.type === 'checkbox' || el.type === 'radio') return 'checkbox';
      return 'text';
    }
    const role = el.getAttribute('role');
    if (role === 'checkbox') return 'checkbox';
    if (el.isContentEditable) return 'editable';
    if (role === 'textbox') return 'editable';
    if (role === 'combobox') return 'combobox';
    return 'clickable';
  }

  function getValue(el) {
    const k = controlKind(el);
    if (k === 'select') {
      const o = el.selectedOptions?.[0];
      return o ? (o.value || o.text || '').trim() : '';
    }
    if (k === 'text') return el.value ?? '';
    if (k === 'checkbox')
      return el.tagName === 'INPUT' ? (el.checked ? 'checked' : '') : el.getAttribute('aria-checked') === 'true' ? 'checked' : '';
    return (el.innerText || el.textContent || '').trim();
  }

  function optionsOf(el) {
    if (el.tagName !== 'SELECT') return undefined;
    return [...el.options].slice(0, 30).map((o) => (o.value === o.text ? o.value : `${o.value}=${clip(o.text, 30)}`));
  }

  function fire(el, type, Ctor = Event, init = {}) {
    const win = el.ownerDocument.defaultView;
    const C = win[Ctor.name] || Ctor;
    el.dispatchEvent(new C(type, { bubbles: true, cancelable: true, ...init }));
  }

  function nativeSet(el, value) {
    const win = el.ownerDocument.defaultView;
    const proto =
      el.tagName === 'SELECT' ? win.HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? win.HTMLTextAreaElement.prototype : win.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  }

  function matchOption(el, wanted) {
    const w = norm(wanted);
    const opts = [...el.options];
    return (
      opts.find((o) => norm(o.value) === w) ||
      opts.find((o) => norm(o.text) === w) ||
      opts.find((o) => norm(o.text).startsWith(w + ' ') || norm(o.text).startsWith(w + ' -') || norm(o.text).startsWith(w + '(')) ||
      (w.length >= 3 ? opts.find((o) => norm(o.text).includes(w)) : undefined)
    );
  }

  function setControl(el, value) {
    const k = controlKind(el);
    el.scrollIntoView?.({ block: 'center', inline: 'center' });
    if (k === 'select') {
      const opt = matchOption(el, value);
      if (!opt) throw new Error(`Option "${value}" not found. Options: ${optionsOf(el).join(', ')}`);
      el.focus?.();
      nativeSet(el, opt.value);
      fire(el, 'input');
      fire(el, 'change');
      el.blur?.();
      return opt.value;
    }
    if (k === 'text') {
      el.focus?.();
      nativeSet(el, value);
      fire(el, 'input', InputEvent, { inputType: 'insertText', data: value });
      fire(el, 'change');
      el.blur?.();
      fire(el, 'focusout', FocusEvent);
      return value;
    }
    if (k === 'checkbox') {
      const want = !['', '0', 'false', 'no', 'ei'].includes(norm(value));
      const isOn = getValue(el) === 'checked';
      if (want !== isOn) el.click();
      return want ? 'checked' : '';
    }
    if (k === 'editable') {
      el.focus?.();
      el.textContent = value;
      fire(el, 'input', InputEvent, { inputType: 'insertText', data: value });
      el.blur?.();
      return value;
    }
    throw new Error('This cell is not a plain input; open it with click and snapshot to see the dialog.');
  }

  function realClick(el) {
    el.scrollIntoView?.({ block: 'center', inline: 'center' });
    const opts = { bubbles: true, cancelable: true, view: el.ownerDocument.defaultView };
    fire(el, 'pointerdown', PointerEvent, opts);
    fire(el, 'mousedown', MouseEvent, opts);
    fire(el, 'pointerup', PointerEvent, opts);
    fire(el, 'mouseup', MouseEvent, opts);
    el.click();
  }

  function highlight(el) {
    el.style.outline = '2px solid #f59e0b';
    el.style.outlineOffset = '-2px';
  }

  // ---------- tables ----------
  function findTables() {
    return qsaAll('table, [role=grid], [role=table], [role=treegrid]').filter((t) => {
      if (!visible(t)) return false;
      // skip layout tables nested in a data cell with a single row
      return rowsOf(t).length >= 1;
    });
  }

  function rowsOf(t) {
    if (t.tagName === 'TABLE') return [...t.rows].filter((r) => r.closest('table') === t);
    return [...t.querySelectorAll('[role=row]')];
  }
  function cellsOf(r) {
    if (r.tagName === 'TR') return [...r.cells];
    return [...r.querySelectorAll('[role=gridcell],[role=cell],[role=columnheader],[role=rowheader]')];
  }
  const isHeaderCell = (c) => c.tagName === 'TH' || ['columnheader'].includes(c.getAttribute('role'));

  // Expand colspan/rowspan into a rectangular grid of cell elements.
  function buildGrid(t) {
    const rows = rowsOf(t);
    const grid = [];
    rows.forEach((r, ri) => {
      grid[ri] = grid[ri] || [];
      let ci = 0;
      for (const c of cellsOf(r)) {
        while (grid[ri][ci]) ci++;
        const cs = Math.max(1, c.colSpan || +c.getAttribute('aria-colspan') || 1);
        const rs = Math.max(1, c.rowSpan || 1);
        for (let dr = 0; dr < rs; dr++)
          for (let dc = 0; dc < cs; dc++) {
            grid[ri + dr] = grid[ri + dr] || [];
            grid[ri + dr][ci + dc] = c;
          }
        ci += cs;
      }
    });
    let headerCount = 0;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const inThead = r.parentElement?.tagName === 'THEAD';
      const allTh = cellsOf(r).length > 0 && cellsOf(r).every(isHeaderCell);
      if (inThead || allTh) headerCount = i + 1;
      else break;
    }
    const width = Math.max(0, ...grid.map((g) => g.length));
    const headers = [];
    for (let c = 0; c < width; c++) {
      const parts = [];
      for (let h = 0; h < headerCount; h++) {
        const cell = grid[h]?.[c];
        const txt = cell ? clip(cell.innerText, 40) : '';
        if (txt && parts[parts.length - 1] !== txt) parts.push(txt);
      }
      headers.push(parts.join(' / '));
    }
    return { rows, grid, headerCount, headers, width };
  }

  const controlIn = (cell) => {
    if (cell.matches?.(CONTROL_SEL)) return cell;
    return [...cell.querySelectorAll(CONTROL_SEL)].find((e) => !e.disabled && visible(e)) || null;
  };

  // Name text of a row = text of cells that contain no editable control.
  function rowNameText(gridRow) {
    const seen = new Set();
    const parts = [];
    for (const c of gridRow || []) {
      if (!c || seen.has(c)) continue;
      seen.add(c);
      if (controlIn(c)) continue;
      const t = (c.innerText || '').trim();
      if (t) parts.push(t);
      if (parts.length >= 3) break;
    }
    return parts.join(' ');
  }

  function nameMatches(query, rowText) {
    // Every query token must equal a row token; a 1-letter token is an initial ("M. Tamm").
    const q = tokens(query);
    const r = tokens(rowText);
    if (!q.length) return false;
    return q.every((t) => r.some((x) => x === t || (t.length === 1 && x.startsWith(t))));
  }

  function describeTable(t, maxRows) {
    const { grid, headerCount, headers, rows } = buildGrid(t);
    const body = [];
    for (let ri = headerCount; ri < rows.length && body.length < maxRows; ri++) {
      const seen = new Set();
      const cells = [];
      (grid[ri] || []).forEach((c, ci) => {
        if (!c || seen.has(c)) return;
        seen.add(c);
        const ctl = controlIn(c);
        if (ctl) {
          const cell = { col: ci, ref: refOf(ctl), kind: controlKind(ctl), value: getValue(ctl) };
          const o = optionsOf(ctl);
          if (o) cell.options = o;
          cells.push(cell);
        } else {
          const txt = clip(c.innerText, 60);
          const clickable = c.querySelector('a[href],button,[role=button],[onclick]') || (c.matches('[onclick],[tabindex]') ? c : null);
          if (txt || clickable) cells.push(clickable ? { col: ci, text: txt, ref: refOf(clickable), kind: 'clickable' } : { col: ci, text: txt });
        }
      });
      body.push({ row: ri, name: clip(rowNameText(grid[ri]), 60), cells });
    }
    return { table_ref: refOf(t), headers, row_count: rows.length - headerCount, rows: body, truncated: rows.length - headerCount > body.length };
  }

  // ---------- tools ----------
  const TOOLS = {
    snapshot({ max_elements = 250, include_text = true } = {}) {
      const els = qsaAll(INTERACTIVE_SEL).filter(visible);
      const elements = [];
      for (const el of els) {
        if (elements.length >= max_elements) break;
        if (el.closest('table,[role=grid]') && el.matches(CONTROL_SEL)) continue; // grid cells: use read_table
        const e = { ref: refOf(el), tag: el.tagName.toLowerCase(), label: labelOf(el) };
        const role = el.getAttribute('role');
        if (role) e.role = role;
        if (el.type && el.tagName === 'INPUT') e.type = el.type;
        if (el.matches(CONTROL_SEL)) e.value = clip(getValue(el), 60);
        const o = optionsOf(el);
        if (o) e.options = o;
        if (el.disabled) e.disabled = true;
        if (el.href) e.href = el.href;
        elements.push(e);
      }
      const tables = findTables().map((t) => {
        const { headers, rows, headerCount } = buildGrid(t);
        return { table_ref: refOf(t), rows: rows.length - headerCount, headers: headers.slice(0, 40) };
      });
      const out = { url: location.href, title: document.title, tables, elements, element_count: els.length };
      if (include_text) out.text = clip(docs().map((d) => d.body?.innerText || '').join('\n'), 5000);
      return out;
    },

    read_table({ table_ref, max_rows = 80 } = {}) {
      const tables = table_ref ? [byRef(table_ref)] : findTables();
      if (!tables.length) return { tables: [], note: 'No tables on this page.' };
      return { tables: tables.map((t) => describeTable(t, max_rows)) };
    },

    bulk_set_attendance({ students, mark, columns, table_ref, overwrite = false, dry_run = false } = {}) {
      if (!Array.isArray(students) || !students.length) throw new Error('students must be a non-empty list');
      if (mark == null) throw new Error('mark is required');
      const tables = table_ref ? [byRef(table_ref)] : findTables();
      const colFilters = (columns || []).map(norm).filter(Boolean);
      const changes = [];
      const not_found = [];
      const ambiguous = [];
      const errors = [];

      // Locate each pupil's row (across all tables).
      const located = [];
      for (const s of students) {
        const hits = [];
        for (const t of tables) {
          const g = buildGrid(t);
          for (let ri = g.headerCount; ri < g.rows.length; ri++) {
            const nt = rowNameText(g.grid[ri]);
            if (nt && nameMatches(s, nt)) hits.push({ t, g, ri, name: clip(nt, 60) });
          }
        }
        // Same pupil may appear once per table (e.g. split journals) — allow one hit per table.
        const perTable = new Map();
        for (const h of hits) perTable.set(h.t, [...(perTable.get(h.t) || []), h]);
        if (!hits.length) not_found.push(s);
        else if ([...perTable.values()].some((v) => v.length > 1))
          ambiguous.push({ student: s, matches: hits.map((h) => h.name) });
        else located.push(...hits.map((h) => ({ ...h, student: s })));
      }

      for (const { g, ri, student, name } of located) {
        const seen = new Set();
        (g.grid[ri] || []).forEach((cell, ci) => {
          if (!cell || seen.has(cell)) return;
          seen.add(cell);
          const ctl = controlIn(cell);
          if (!ctl) return;
          const header = g.headers[ci] || `column ${ci}`;
          if (colFilters.length && !colFilters.some((f) => norm(header).includes(f))) return;
          const kind = controlKind(ctl);
          if (kind === 'clickable' || kind === 'combobox') return;
          const from = getValue(ctl);
          const rec = { student, row: name, column: header, ref: refOf(ctl), from };
          if (kind === 'select') {
            const opt = matchOption(ctl, mark);
            if (!opt) {
              errors.push({ ...rec, error: `no option "${mark}" (options: ${optionsOf(ctl).join(', ')})` });
              return;
            }
            if (norm(from) === norm(opt.value)) return changes.push({ ...rec, to: opt.value, status: 'already' });
          } else if (norm(from) === norm(mark)) return changes.push({ ...rec, to: mark, status: 'already' });
          if (from && !overwrite) return changes.push({ ...rec, to: mark, status: 'skipped_has_value' });
          if (dry_run) return changes.push({ ...rec, to: mark, status: 'would_set' });
          try {
            const to = setControl(ctl, mark);
            highlight(ctl);
            changes.push({ ...rec, to, status: 'set' });
          } catch (e) {
            errors.push({ ...rec, error: e.message });
          }
        });
      }

      const count = (st) => changes.filter((c) => c.status === st).length;
      return {
        dry_run,
        summary: {
          set: count('set'),
          would_set: count('would_set'),
          already: count('already'),
          skipped_has_value: count('skipped_has_value'),
          errors: errors.length,
          not_found: not_found.length,
          ambiguous: ambiguous.length,
        },
        changes,
        errors,
        not_found,
        ambiguous,
        note: dry_run ? 'Preview only, nothing changed.' : 'Changed on screen only (highlighted in orange). Nothing is saved until the teacher clicks Save.',
      };
    },

    click({ ref, text } = {}) {
      let el;
      if (ref) el = byRef(ref);
      else if (text) {
        const w = norm(text);
        const cands = qsaAll(INTERACTIVE_SEL).filter(visible);
        el = cands.find((e) => norm(labelOf(e)) === w) || cands.find((e) => norm(labelOf(e)).includes(w));
        if (!el) throw new Error(`Nothing clickable labelled "${text}"`);
      } else throw new Error('Give ref or text');
      realClick(el);
      return { clicked: { ref: refOf(el), label: labelOf(el) } };
    },

    fill({ ref, value }) {
      const el = byRef(ref);
      const v = setControl(el, value);
      highlight(el);
      return { ref, value: v };
    },

    select_option({ ref, value }) {
      const el = byRef(ref);
      if (el.tagName !== 'SELECT') throw new Error('Element is not a <select>; use click to open custom dropdowns.');
      const v = setControl(el, value);
      highlight(el);
      return { ref, value: v };
    },

    async wait_for({ text, timeout_ms = 10000 }) {
      const w = norm(text);
      const end = Date.now() + timeout_ms;
      while (Date.now() < end) {
        if (docs().some((d) => norm(d.body?.innerText).includes(w))) return { found: true };
        await new Promise((r) => setTimeout(r, 250));
      }
      return { found: false };
    },
  };

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type !== 'ekh-tool') return;
    const fn = TOOLS[msg.tool];
    if (!fn) {
      sendResponse({ ok: false, error: `Unknown page tool ${msg.tool}` });
      return;
    }
    Promise.resolve()
      .then(() => fn(msg.args || {}))
      .then(
        (result) => sendResponse({ ok: true, result }),
        (e) => sendResponse({ ok: false, error: String(e?.message || e) })
      );
    return true;
  });
})();
