/* ============================================================================
   Croc Commander — renderer
   Gestore file a doppio pannello + trasferimenti croc
   ============================================================================ */
'use strict';

/* ------------------------------------------------------------------ */
/* Utilità                                                              */
/* ------------------------------------------------------------------ */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

let toastTimer = null;
function toast(msg, ms = 2200) {
  const t = $('#toast');
  t.textContent = msg;
  t.style.display = 'block';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.style.display = 'none'; }, ms);
}

/* ---- path utils (POSIX-ish, tollera backslash) ---- */
const p = {
  norm(s) {
    if (!s) return s;
    const abs = s.startsWith('/');
    const out = [];
    for (const part of String(s).replace(/\\/g, '/').split('/')) {
      if (!part || part === '.') continue;
      if (part === '..') { if (out.length && out[out.length - 1] !== '..') out.pop(); else if (!abs) out.push('..'); }
      else out.push(part);
    }
    let r = out.join('/');
    if (abs) r = '/' + r;
    return r || (abs ? '/' : '.');
  },
  join(...a) { return p.norm(a.join('/')); },
  dir(s) { const n = p.norm(s); return p.norm(n.replace(/\/[^/]*$/, '') || '/'); },
  base(s) { const n = p.norm(s); return n.split('/').pop() || n; },
  isAbs(s) { return /^\//.test(s) || /^[A-Za-z]:/.test(s); },
  resolve(base, rel) { return p.norm(p.isAbs(rel) ? rel : p.join(base, rel)); }
};

function fmtSize(n) {
  if (n < 0) return '<DIR>';
  if (n < 1024) return n + ' B';
  const u = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024, i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return (v >= 100 ? v.toFixed(0) : v.toFixed(1)) + ' ' + u[i];
}
function fmtDate(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  const pad = (x) => String(x).padStart(2, '0');
  return pad(d.getDate()) + '-' + pad(d.getMonth() + 1) + '-' + String(d.getFullYear()).slice(2);
}
function fmtTime(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  const pad = (x) => String(x).padStart(2, '0');
  return pad(d.getHours()) + ':' + pad(d.getMinutes());
}
function globRe(pattern) {
  return new RegExp('^' + pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.') + '$', 'i');
}
function globMatch(pattern, name) { return globRe(pattern).test(name); }
function extOf(name) {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i + 1).toLowerCase() : '';
}
const TEXT_EXT = /\.(txt|md|log|conf|cfg|ini|sh|bash|py|js|ts|json|yaml|yml|xml|html|css|c|cpp|h|hpp|java|go|rs|rb|pl|php|lua|sql|toml|env|gitignore|editorconfig|lock|out|err|diff|patch|csv|tsv)$/i;
const IMAGE_EXT = /\.(png|jpg|jpeg|gif|webp|bmp)$/i;

/* ------------------------------------------------------------------ */
/* Stato                                                               */
/* ------------------------------------------------------------------ */
const P = {
  left: { id: 'left', path: '/', entries: [], display: [], cursor: 0, selected: new Set(), mode: 'full', sort: 'name', sortDir: 1, filter: '*', history: [], disk: null, err: null },
  right: { id: 'right', path: '/', entries: [], display: [], cursor: 0, selected: new Set(), mode: 'full', sort: 'name', sortDir: 1, filter: '*', history: [], disk: null, err: null }
};
let activeId = 'left';
let opts = { showHidden: false, keyBar: true, pathPrompt: true, theme: 'classic', relay: '', relayPass: '', customCode: '' };
let cmdHist = [];
let cmdHistIdx = -1;

const act = () => P[activeId];
const inact = () => P[activeId === 'left' ? 'right' : 'left'];

let dlgStack = [];   // dialoghi aperti
let screen = null;   // visualizzatore/editor a schermo intero
let menu = null;     // menu a tendina aperto

const DEFAULT_RELAY = '142.132.189.179:9009';

/* ------------------------------------------------------------------ */
/* Bus eventi (i listener del preload smistano ai consumatori)         */
/* ------------------------------------------------------------------ */
const crocBus = { code: null, progress: null, output: null, prompt: null };
ncAPI.onCrocCode((c) => crocBus.code && crocBus.code(c));
ncAPI.onCrocProgress((t) => crocBus.progress && crocBus.progress(t));
ncAPI.onCrocOutput((t) => crocBus.output && crocBus.output(t));
ncAPI.onCrocPrompt((d) => crocBus.prompt && crocBus.prompt(d));

let shellConsumer = null;
ncAPI.onShellOutput((d) => shellConsumer && shellConsumer(d));

/* ------------------------------------------------------------------ */
/* Persistenza impostazioni                                            */
/* ------------------------------------------------------------------ */
const SET_KEY = 'crocCommander.v2';
function saveSettings() {
  try {
    localStorage.setItem(SET_KEY, JSON.stringify({
      left: P.left.path, right: P.right.path, active: activeId,
      sort: P.left.sort, mode: P.left.mode, filter: P.left.filter,
      showHidden: opts.showHidden, keyBar: opts.keyBar, pathPrompt: opts.pathPrompt,
      theme: opts.theme, cmdHist, relay: opts.relay, relayPass: opts.relayPass, customCode: opts.customCode
    }));
  } catch {}
}
function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(SET_KEY) || '{}');
    if (s.left) P.left.path = s.left;
    if (s.right) P.right.path = s.right;
    if (s.active) activeId = s.active;
    ['left', 'right'].forEach(id => {
      if (s.sort) P[id].sort = s.sort;
      if (s.mode) P[id].mode = s.mode;
      if (s.filter) P[id].filter = s.filter;
    });
    if (typeof s.showHidden === 'boolean') opts.showHidden = s.showHidden;
    if (typeof s.keyBar === 'boolean') opts.keyBar = s.keyBar;
    if (typeof s.pathPrompt === 'boolean') opts.pathPrompt = s.pathPrompt;
    if (s.theme) opts.theme = s.theme;
    if (Array.isArray(s.cmdHist)) cmdHist = s.cmdHist;
    if (typeof s.relay === 'string') opts.relay = s.relay;
    if (typeof s.relayPass === 'string') opts.relayPass = s.relayPass;
    if (typeof s.customCode === 'string') opts.customCode = s.customCode;
  } catch {}
}

/* ------------------------------------------------------------------ */
/* Rendering pannelli                                                  */
/* ------------------------------------------------------------------ */
const COL_FULL = [['name', 'Nome'], ['size', 'Dimens.'], ['date', 'Data'], ['time', 'Ora'], ['attr', 'Attrib.']];

function sortEntries(list, key, dir) {
  const d = dir || 1;
  list.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    let r = 0;
    if (key === 'name') r = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    else if (key === 'ext') r = extOf(a.name).localeCompare(extOf(b.name)) || a.name.localeCompare(b.name);
    else if (key === 'time') r = (a.mtime || 0) - (b.mtime || 0);
    else if (key === 'size') r = (a.size || 0) - (b.size || 0);
    return r * d;
  });
}

function computeDisplay(panel) {
  let list = panel.entries.filter(e => !e.hidden || opts.showHidden);
  if (panel.filter && panel.filter !== '*') list = list.filter(e => globMatch(panel.filter, e.name));
  sortEntries(list, panel.sort, panel.sortDir);
  panel.display = list;
  if (panel.cursor >= panel.display.length) panel.cursor = Math.max(0, panel.display.length - 1);
}

async function loadDir(panel, keepCursor = true) {
  const res = await ncAPI.list(panel.path);
  if (!res.ok) {
    panel.err = res.error;
    panel.entries = [];
    panel.display = [];
    toast('Impossibile leggere ' + panel.path + ': ' + res.error);
    renderPanel(panel.id);
    return;
  }
  panel.err = null;
  panel.entries = res.entries;
  computeDisplay(panel);
  panel.disk = await ncAPI.disk(panel.path).catch(() => null);
  renderPanel(panel.id);
}

function cd(panel, target) {
  const t = p.norm(target);
  if (t === panel.path) return;
  ncAPI.stat(t).then(st => {
    if (!st || !st.exists || !st.isDirectory) { toast('Non è una cartella: ' + t); return; }
    panel.history.push(panel.path);
    if (panel.history.length > 100) panel.history.shift();
    panel.path = t;
    panel.cursor = 0;
    panel.selected.clear();
    loadDir(panel, false).then(() => { saveSettings(); });
  });
}

function parentOf(panel) {
  const up = p.dir(panel.path);
  if (up !== panel.path) cd(panel, up);
}

function renderPanel(id) {
  const panel = P[id];
  const isActive = id === activeId;
  const pane = $('#pane-' + id);
  pane.classList.toggle('active', isActive);
  pane.classList.toggle('inactive', !isActive);

  $('#path-' + id).textContent = panel.path;

  const cols = $('#cols-' + id);
  const list = $('#list-' + id);
  list.classList.remove('brief');

  if (panel.mode === 'full' || panel.mode === 'brief') {
    cols.style.display = 'flex';
    if (panel.mode === 'brief') { list.classList.add('brief'); cols.innerHTML = '<div class="c name">Nome</div>'; }
    else cols.innerHTML = COL_FULL.map(([k, l]) => `<div class="c ${k}" data-key="${k}">${l}${panel.sort === k ? (panel.sortDir === 1 ? ' ▲' : ' ▼') : ''}</div>`).join('');
    $$('.c[data-key]', cols).forEach(c => {
      c.onclick = () => { toggleSort(panel, c.dataset.key); };
    });
    renderList(panel, list);
  } else if (panel.mode === 'info') {
    cols.style.display = 'none';
    renderInfo(panel, list);
  }

  // piè di pagina
  const foot = $('#foot-' + id);
  const selCount = panel.selected.size;
  const freeStr = panel.disk ? `${fmtSize(panel.disk.free)} liberi di ${fmtSize(panel.disk.total)}` : '';
  foot.innerHTML =
    `<div>${esc(panel.path)}&nbsp;&nbsp;file: ${panel.entries.length}  selezionati: ${selCount}</div>` +
    `<div class="dim">${freeStr || ' '}</div>`;
}

function renderList(panel, list) {
  const disp = panel.display;
  const brief = panel.mode === 'brief';
  let html = '';
  const dots = [];
  dots.push({ name: '.', size: -1, isDir: true, mtime: Date.now(), mode: 'drwxr-xr-x' });
  dots.push({ name: '..', size: -1, isDir: true, mtime: Date.now(), mode: 'drwxr-xr-x' });
  const rows = dots.concat(disp);
  panel._rows = rows;
  for (let i = 0; i < rows.length; i++) {
    const e = rows[i];
    const cur = i === panel.cursor ? ' cur' : '';
    const sel = panel.selected.has(e.name) ? ' sel' : '';
    const hid = e.hidden ? ' hid' : '';
    if (brief) {
      html += `<div class="row${cur}${sel}" data-idx="${i}"><div class="c name${hid}">${esc(e.name)}</div></div>`;
    } else {
      html += `<div class="row${cur}${sel}" data-idx="${i}">` +
        `<div class="c name${hid}">${esc(e.name)}</div>` +
        `<div class="c size">${fmtSize(e.size)}</div>` +
        `<div class="c date">${fmtDate(e.mtime)}</div>` +
        `<div class="c time">${fmtTime(e.mtime)}</div>` +
        `<div class="c attr">${esc(e.mode)}</div></div>`;
    }
  }
  list.innerHTML = html;
  scrollCursorIntoView(list, panel.cursor);
}

function scrollCursorIntoView(list, idx) {
  const row = list.querySelector(`.row[data-idx="${idx}"]`);
  if (!row) return;
  const rh = row.offsetHeight || 18;
  if (row.offsetTop < list.scrollTop) list.scrollTop = row.offsetTop;
  else if (row.offsetTop + rh > list.scrollTop + list.clientHeight) list.scrollTop = row.offsetTop + rh - list.clientHeight;
}

function renderInfo(panel, list) {
  const rows = panel._rows || [];
  const e = rows[panel.cursor] || null;
  const lines = [];
  if (e) {
    lines.push('File:        ' + e.name);
    lines.push('Dimensione:  ' + (e.isDir ? '<DIR>' : fmtSize(e.size) + ' (' + e.size + ' byte)'));
    lines.push('Data:        ' + fmtDate(e.mtime));
    lines.push('Ora:         ' + fmtTime(e.mtime));
    lines.push('Attributi:   ' + e.mode);
  }
  lines.push('');
  if (panel.disk) {
    lines.push('Drive:       ' + panel.path);
    lines.push('Totale:      ' + fmtSize(panel.disk.total));
    lines.push('Liberi:      ' + fmtSize(panel.disk.free));
  }
  lines.push('');
  lines.push('Cartella:    ' + panel.path);
  lines.push('File:        ' + panel.entries.length);
  lines.push('Selezionati: ' + panel.selected.size);
  list.innerHTML = `<div class="pcontent"><pre>${esc(lines.join('\n'))}</pre></div>`;
}

/* ------------------------------------------------------------------ */
/* Pannello attivo + cursore                                           */
/* ------------------------------------------------------------------ */
function setActive(id) {
  if (activeId === id) return;
  activeId = id;
  renderPanels();
  updateCmdPrompt();
  saveSettings();
}
function renderPanels() { renderPanel('left'); renderPanel('right'); }

function setCursor(panel, idx, { scroll = true } = {}) {
  const rows = panel._rows || [];
  if (!rows.length) return;
  if (idx < 0) idx = 0;
  if (idx >= rows.length) idx = rows.length - 1;
  panel.cursor = idx;
  renderPanel(panel.id);
}

function toggleSelect(panel) {
  const e = (panel._rows || [])[panel.cursor];
  if (!e || e.name === '.' || e.name === '..') return;
  if (panel.selected.has(e.name)) panel.selected.delete(e.name);
  else panel.selected.add(e.name);
  if (panel.cursor < (panel._rows || []).length - 1) panel.cursor++;
  renderPanel(panel.id);
}

function toggleSort(panel, key) {
  if (panel.sort === key) panel.sortDir = -panel.sortDir;
  else { panel.sort = key; panel.sortDir = 1; }
  computeDisplay(panel);
  renderPanel(panel.id);
  saveSettings();
}

function selectGroupDlg(select) {
  const title = select ? 'Seleziona gruppo' : 'Deseleziona gruppo';
  inputDlg(title, 'Maschera (es. *.txt):', panelFilterOf(act()), (mask) => {
    const panel = act();
    const re = globRe(mask);
    (panel._rows || []).forEach(e => {
      if (e.name === '.' || e.name === '..') return;
      if (re.test(e.name)) { if (select) panel.selected.add(e.name); else panel.selected.delete(e.name); }
    });
    renderPanel(panel.id);
  });
}
function panelFilterOf(panel) { return panel.filter && panel.filter !== '*' ? panel.filter : '*'; }

function invertSelection(panel) {
  (panel._rows || []).forEach(e => {
    if (e.name === '.' || e.name === '..') return;
    if (panel.selected.has(e.name)) panel.selected.delete(e.name); else panel.selected.add(e.name);
  });
  renderPanel(panel.id);
}

function selectedEntries(panel) { return (panel._rows || []).filter(e => panel.selected.has(e.name)); }
function selectedPaths(panel) { return selectedEntries(panel).map(e => p.join(panel.path, e.name)); }
function currentEntry(panel) { return (panel._rows || [])[panel.cursor] || null; }
function targetPaths(panel) {
  const s = selectedPaths(panel);
  if (s.length) return s;
  const c = currentEntry(panel);
  return (c && c.name !== '.' && c.name !== '..') ? [p.join(panel.path, c.name)] : [];
}

/* ------------------------------------------------------------------ */
/* Framework dialoghi                                                  */
/* ------------------------------------------------------------------ */
function openDlg(html, o = {}) {
  const back = el('div', 'dlg-back');
  const dlg = el('div', 'dlg');
  dlg.innerHTML = html;
  back.appendChild(dlg);
  $('#dlgRoot').appendChild(back);
  const d = { root: back, el: dlg, keys: o.keys || null, onClose: o.onClose || null, noEsc: !!o.noEsc, id: Math.random().toString(36).slice(2) };
  dlgStack.push(d);
  dlg.style.left = '50%';
  dlg.style.top = '42%';
  dlg.style.transform = 'translate(-50%, -50%)';
  const inp = $('input[type=text]', dlg);
  if (inp && o.focus !== false) setTimeout(() => { inp.focus(); inp.select(); }, 10);
  return d;
}
function closeDlg(d) {
  const i = dlgStack.indexOf(d);
  if (i >= 0) dlgStack.splice(i, 1);
  d.root.remove();
  if (d.onClose) { try { d.onClose(); } catch {} }
}

function confirmDlg(title, text, onYes, o = {}) {
  const d = openDlg(
    `<h1>${esc(title)}</h1><div class="dlg-body"><div class="dlg-line">${esc(text)}</div>` +
    `<div class="dlg-keys"><b>S</b>=Sì&nbsp;&nbsp;<b>N</b>=No&nbsp;&nbsp;<b>Esc</b>=Annulla</div></div>`,
    {
      keys(e) {
        if (e.key === 's' || e.key === 'S' || e.key === 'y' || e.key === 'Y' || e.key === 'Enter') { closeDlg(d); onYes && onYes(); return true; }
        if (e.key === 'n' || e.key === 'N') { closeDlg(d); o.onNo && o.onNo(); return true; }
        if (e.key === 'Escape') { closeDlg(d); return true; }
        return false;
      }
    }
  );
  return d;
}

function inputDlg(title, label, value, onOk) {
  const d = openDlg(
    `<h1>${esc(title)}</h1><div class="dlg-body">
      <div class="dlg-line">${esc(label || '')}</div>
      <input type="text" id="dlg-input" value="${esc(value || '')}">
      <div class="dlg-keys"><b>Invio</b>=OK&nbsp;&nbsp;<b>Esc</b>=Annulla</div>
    </div>`,
    {
      keys(e) {
        if (e.key === 'Enter') { const v = $('#dlg-input', d.el).value; closeDlg(d); onOk && onOk(v); return true; }
        if (e.key === 'Escape') { closeDlg(d); return true; }
        return false;
      }
    }
  );
  return d;
}

function listDlg(title, items, onPick, o = {}) {
  let cur = 0;
  const d = openDlg(
    `<h1>${esc(title)}</h1><div class="dlg-body">
      <div class="dlist" id="dlg-list"></div>
      <div class="dlg-keys"><b>↑↓</b>=sposta&nbsp;&nbsp;<b>Invio</b>=seleziona&nbsp;&nbsp;<b>Esc</b>=chiudi</div>
    </div>`,
    {
      keys(e) {
        if (e.key === 'ArrowDown') { cur = Math.min(items.length - 1, cur + 1); paint(); return true; }
        if (e.key === 'ArrowUp') { cur = Math.max(0, cur - 1); paint(); return true; }
        if (e.key === 'Enter') { closeDlg(d); onPick && onPick(items[cur], cur); return true; }
        if (e.key === 'Escape') { closeDlg(d); return true; }
        return false;
      }
    }
  );
  function paint() {
    const box = $('#dlg-list', d.el);
    box.innerHTML = items.map((it, i) => `<div class="drow${i === cur ? ' cur' : ''}" data-i="${i}">${it.html}</div>`).join('');
    box.onclick = (ev) => {
      const row = ev.target.closest('.drow');
      if (!row) return;
      cur = +row.dataset.i;
      closeDlg(d);
      onPick && onPick(items[cur], cur);
    };
    const r = box.querySelector('.drow.cur');
    if (r) { r.scrollIntoView({ block: 'nearest' }); }
  }
  paint();
  return d;
}

/* ------------------------------------------------------------------ */
/* Tastiera globale                                                    */
/* ------------------------------------------------------------------ */
function isFKey(e) { return /^F([1-9]|10)$/.test(e.key); }

window.addEventListener('keydown', (e) => {
  if (dlgStack.length) { dlgKeys(e); return; }
  if (screen) { screen.keys(e); return; }
  if (menu) { menuKeys(e); return; }
  appKeys(e);
});

function dlgKeys(e) {
  const d = dlgStack[dlgStack.length - 1];
  if (d.keys) { if (d.keys(e)) return; }
  if (e.key === 'Escape' && !d.noEsc) closeDlg(d);
}

function appKeys(e) {
  const k = e.key;
  const inCmd = e.target === $('#cmdInput');

  // ---- tasti funzione ----
  if (isFKey(e)) {
    e.preventDefault();
    switch (k) {
      case 'F1': helpDlg(); break;
      case 'F2': editCurrent(); break;
      case 'F3': viewCurrent(); break;
      case 'F4': fileInfoDlg(); break;
      case 'F5': crocSendDlg(targetPaths(act())); break;
      case 'F6': crocRecvDlg(); break;
      case 'F7': customCodeDlg(); break;
      case 'F8': relayDlg(); break;
      case 'F9': toggleMenu(null); break;
      case 'F10': quitDlg(); break;
    }
    return;
  }

  // ---- combinazioni Alt ----
  if (e.altKey) {
    switch (k) {
      case 'F1': e.preventDefault(); drivesDlg(P.left); break;
      case 'F2': e.preventDefault(); drivesDlg(P.right); break;
      case 'F5': e.preventDefault(); crocSendDlg(targetPaths(act())); break;
      case 'F6': e.preventDefault(); crocRecvDlg(); break;
      case 'F7': e.preventDefault(); searchDlg(); break;
      case 'F8': e.preventDefault(); historyDlg(); break;
      case 'F9': e.preventDefault(); toggleMenu(null); break;
      case 'Enter': e.preventDefault(); fileInfoDlg(); break;
      default: {
        const m = { s: 'Left', f: 'Files', c: 'Commands', o: 'Options', d: 'Right' }[k.toLowerCase()];
        if (m) { e.preventDefault(); toggleMenu(m); }
        break;
      }
    }
    return;
  }

  // ---- combinazioni Ctrl ----
  if (e.ctrlKey) {
    switch (k) {
      case 'F1': e.preventDefault(); setMode(act(), 'brief'); break;
      case 'F2': e.preventDefault(); setMode(act(), 'full'); break;
      case 'F3': e.preventDefault(); setMode(act(), 'info'); break;
      case 'F5': e.preventDefault(); setSort(act(), 'name'); break;
      case 'F6': e.preventDefault(); setSort(act(), 'ext'); break;
      case 'F7': e.preventDefault(); setSort(act(), 'time'); break;
      case 'F8': e.preventDefault(); setSort(act(), 'size'); break;
      case 'F9': e.preventDefault(); setSort(act(), 'name'); break;
      case 'u': case 'U': e.preventDefault(); swapPanels(); break;
      case 'r': case 'R': e.preventDefault(); loadDir(act(), true); break;
      case 'p': case 'P': e.preventDefault(); if (inact().path !== act().path) cd(inact(), act().path); break;
      case 'Enter': e.preventDefault(); { const c = currentEntry(act()); if (c && c.name !== '.' && c.name !== '..') cmdInputValue(p.join(act().path, c.name)); } break;
      case '\\': e.preventDefault(); mountRoot(act()); break;
      default: return; // lascia i tasti al browser (copia/incolla nella riga comando)
    }
    return;
  }

  // ---- tasti mentre si scrive nella riga comando ----
  if (inCmd) return;

  // ---- navigazione / selezione ----
  const panel = act();
  switch (k) {
    case 'Tab': e.preventDefault(); setActive(activeId === 'left' ? 'right' : 'left'); return;
    case 'ArrowDown': setCursor(panel, panel.cursor + 1); return;
    case 'ArrowUp': setCursor(panel, panel.cursor - 1); return;
    case 'PageDown': setCursor(panel, panel.cursor + 8); return;
    case 'PageUp': setCursor(panel, panel.cursor - 8); return;
    case 'Home': setCursor(panel, 0); return;
    case 'End': setCursor(panel, 999999); return;
    case 'ArrowRight': e.preventDefault(); enterCurrent(); return;
    case 'ArrowLeft': e.preventDefault(); parentOf(panel); return;
    case 'Enter': e.preventDefault(); enterCurrent(); return;
    case 'Backspace': parentOf(panel); return;
    case 'Insert': case ' ': toggleSelect(panel); return;
    case '+': selectGroupDlg(true); return;
    case '-': selectGroupDlg(false); return;
    case '*': invertSelection(panel); return;
    case 'Escape': clearCmd(); return;
  }

  // ---- caratteri stampabili -> riga comando (come NC) ----
  if (!e.metaKey && k.length === 1) {
    const inp = $('#cmdInput');
    inp.focus();
    inp.value = inp.value + k;
    inp.setSelectionRange(inp.value.length, inp.value.length);
  }
}

function setMode(panel, mode) {
  panel.mode = mode;
  renderPanel(panel.id);
  saveSettings();
}
function setSort(panel, key) {
  if (panel.sort === key && key !== 'name') panel.sortDir = -panel.sortDir;
  else { panel.sort = key; panel.sortDir = 1; }
  computeDisplay(panel);
  renderPanel(panel.id);
  saveSettings();
}

function swapPanels() {
  const a = P.left, b = P.right;
  for (const k of ['path', 'entries', 'display', 'cursor', 'selected', 'history', 'mode', 'filter', 'sort', 'sortDir', 'disk', 'err']) {
    [a[k], b[k]] = [b[k], a[k]];
  }
  renderPanels();
  saveSettings();
}

function mountRoot(panel) {
  ncAPI.drives().then(drives => {
    let root = '/';
    for (const d of drives) if (panel.path.startsWith(d.path) && d.path.length > root.length) root = d.path;
    cd(panel, root);
  });
}

/* ---- riga di comando ---- */
function cmdInputValue(v) { const i = $('#cmdInput'); i.value = v; i.focus(); }
function clearCmd() { const i = $('#cmdInput'); i.value = ''; i.blur(); }

async function execCmd(raw) {
  const cmd = raw.trim();
  clearCmd();
  if (!cmd) return;
  cmdHist = cmdHist.filter(c => c !== cmd);
  cmdHist.push(cmd);
  if (cmdHist.length > 60) cmdHist.shift();
  cmdHistIdx = -1;
  saveSettings();

  const panel = act();

  // comandi interni
  if (/^cd\b/.test(cmd)) {
    let t = cmd.slice(2).trim() || '~';
    if (t === '~') t = await homePath();
    else if (t.startsWith('~/')) t = (await homePath()) + t.slice(1);
    cd(panel, p.resolve(panel.path, t));
    return;
  }
  const cm = cmd.match(/^(croc\s+)?(send|recv|receive|invia|ricevi)\b\s*(.*)$/i);
  if (cm) {
    if (/send|invia/i.test(cm[2])) {
      const args = cm[3] ? cm[3].split(/\s+/).map(a => p.resolve(panel.path, a)) : [];
      crocSendDlg(args.length ? args : targetPaths(panel));
    } else {
      crocRecvDlg(cm[3] ? cm[3].trim() : '');
    }
    return;
  }
  if (/^(help|aiuto|\?)$/i.test(cmd)) { helpDlg(); return; }
  if (/^(exit|quit|esci)$/i.test(cmd)) { quitDlg(); return; }

  // voce esistente nella cartella corrente?
  const first = cmd.split(/\s+/)[0];
  const exact = (panel._rows || []).find(e => e.name === first);
  if (exact && !/[*?]/.test(cmd)) {
    const fp = p.join(panel.path, exact.name);
    if (exact.isDir) { cd(panel, fp); return; }
    if (TEXT_EXT.test(exact.name)) { openViewer(fp); return; }
    if (IMAGE_EXT.test(exact.name)) { openImageViewer(fp); return; }
    ncAPI.openPath(fp);
    return;
  }

  // esecuzione in shell
  runShell(cmd, panel.path);
}

async function homePath() { return (await ncAPI.home().catch(() => '~')) || '~'; }

function runShell(cmd, cwd) {
  const d = openDlg(
    `<h1>Uscita comando</h1><div class="dlg-body">
      <div class="dlg-line dim">${esc(cwd)}&gt; ${esc(cmd)}</div>
      <div class="log" id="sh-log" style="height:38vh"></div>
      <div class="dlg-keys" id="sh-status"><b>Esc</b>=annulla</div>
    </div>`,
    { noEsc: true, focus: false }
  );
  const log = $('#sh-log', d.el);
  const status = $('#sh-status', d.el);
  let done = false;
  const append = (t) => { log.textContent += t; log.scrollTop = log.scrollHeight; };
  const consumer = (msg) => { if (!done) append(msg.chunk); };
  shellConsumer = consumer;
  const onKey = (ev) => {
    if (!done) { ev.preventDefault(); ev.stopPropagation(); ncAPI.kill(); append('\n[annullato]\n'); done = true; status.innerHTML = '<b>Invio</b>/<b>Esc</b>=chiudi'; }
    else { ev.stopPropagation(); window.removeEventListener('keydown', onKey, true); closeDlg(d); }
  };
  window.addEventListener('keydown', onKey, true);
  ncAPI.exec({ cmd, cwd }).then(res => {
    done = true;
    append(`\n[codice di uscita ${res.code}]`);
    status.innerHTML = '<b>Invio</b>/<b>Esc</b>=chiudi';
  });
}

/* ------------------------------------------------------------------ */
/* Menu                                                                */
/* ------------------------------------------------------------------ */
function buildMenuData() {
  const panelMenu = (pid) => [
    { label: 'Breve', hot: 'B', acc: 'Ctrl+F1', fn: () => setMode(P[pid], 'brief') },
    { label: 'Completo', hot: 'C', acc: 'Ctrl+F2', fn: () => setMode(P[pid], 'full') },
    { label: 'Info', hot: 'I', acc: 'Ctrl+F3', fn: () => setMode(P[pid], 'info') },
    { sep: true },
    { label: 'Rileggi', hot: 'R', acc: 'Ctrl+R', fn: () => loadDir(P[pid], true) },
    { label: 'Filtro…', hot: 'F', fn: () => inputDlg('Filtro', 'Maschera (es. *.txt):', panelFilterOf(P[pid]), (v) => { P[pid].filter = v.trim() || '*'; computeDisplay(P[pid]); renderPanel(pid); saveSettings(); }) },
    { sep: true },
    { label: 'Ordina', hot: 'O', sub: [
      { label: 'Nome', hot: 'N', acc: 'Ctrl+F5', fn: () => setSort(P[pid], 'name') },
      { label: 'Estensione', hot: 'E', acc: 'Ctrl+F6', fn: () => setSort(P[pid], 'ext') },
      { label: 'Tempo', hot: 'T', acc: 'Ctrl+F7', fn: () => setSort(P[pid], 'time') },
      { label: 'Dimensione', hot: 'D', acc: 'Ctrl+F8', fn: () => setSort(P[pid], 'size') },
      { label: 'Nessun ordine', hot: 'O', acc: 'Ctrl+F9', fn: () => setSort(P[pid], 'name') }
    ] },
    { sep: true },
    { label: 'Drive…', hot: 'D', acc: 'Alt+F1', fn: () => drivesDlg(P[pid]) }
  ];
  return {
    Left: panelMenu('left'),
    Files: [
      { label: 'Invia file…', hot: 'I', acc: 'F5', fn: () => crocSendDlg(targetPaths(act())) },
      { label: 'Ricevi file…', hot: 'R', acc: 'F6', fn: () => crocRecvDlg() },
      { sep: true },
      { label: 'Codice personalizzato…', hot: 'C', acc: 'F7', fn: () => customCodeDlg() },
      { label: 'Imposta relay…', hot: 'P', acc: 'F8', fn: () => relayDlg() },
      { sep: true },
      { label: 'Vedi', hot: 'V', acc: 'F3', fn: () => viewCurrent() },
      { label: 'Modifica', hot: 'M', acc: 'F2', fn: () => editCurrent() },
      { label: 'Info file', hot: 'F', acc: 'F4', fn: () => fileInfoDlg() }
    ],
    Commands: [
      { label: 'Trova file…', hot: 'T', acc: 'Alt+F7', fn: () => searchDlg() },
      { label: 'Cronologia…', hot: 'C', acc: 'Alt+F8', fn: () => historyDlg() },
      { label: 'Scambia pannelli', hot: 'S', acc: 'Ctrl+U', fn: () => swapPanels() },
      { label: 'Copia percorso', hot: 'P', acc: 'Ctrl+P', fn: () => { const a = act(); if (inact().path !== a.path) cd(inact(), a.path); } },
      { label: 'Radice del drive', hot: 'R', acc: 'Ctrl+\\', fn: () => mountRoot(act()) },
      { sep: true },
      { label: 'Shell…', hot: 'H', fn: () => shellDlg() },
      { label: 'Info di sistema…', hot: 'I', fn: () => sysInfoDlg() },
      { sep: true },
      { label: 'Aiuto', hot: 'A', acc: 'F1', fn: () => helpDlg() },
      { label: 'Esci', hot: 'E', acc: 'F10', fn: () => quitDlg() }
    ],
    Options: [
      { label: 'Colori schermo', hot: 'C', sub: ['classic', 'green', 'amber', 'gray', 'black'].map((c, i) => {
        const n = ['Classico', 'Verde', 'Ambra', 'Grigio', 'Nero'][i];
        return { label: n, hot: n[0], fn: () => applyTheme(c) };
      }) },
      { label: 'Pannello', hot: 'P', sub: [
        { label: 'Mostra file nascosti', hot: 'M', acc: opts.showHidden ? '✓' : '', fn: () => { opts.showHidden = !opts.showHidden; saveSettings(); renderPanels(); } },
        { label: 'Barra tasti', hot: 'B', acc: opts.keyBar ? '✓' : '', fn: () => { opts.keyBar = !opts.keyBar; applyOpts(); } },
        { label: 'Prompt percorso', hot: 'P', acc: opts.pathPrompt ? '✓' : '', fn: () => { opts.pathPrompt = !opts.pathPrompt; applyOpts(); } }
      ] },
      { sep: true },
      { label: 'Salva impostazioni', hot: 'S', fn: () => { saveSettings(); toast('Impostazioni salvate'); } }
    ],
    Right: panelMenu('right')
  };
}

function buildKeyBar() {
  const keys = [['1', 'Aiuto'], ['2', 'Modifica'], ['3', 'Vedi'], ['4', 'Info'], ['5', 'Invia'], ['6', 'Ricevi'], ['7', 'Codice'], ['8', 'Relay'], ['9', 'Menu'], ['10', 'Esci']];
  $('#keyBar').innerHTML = keys.map(([n, l]) => `<div class="fkey" data-f="${n}"><span class="n">${n}</span> <span class="lbl">${l}</span></div>`).join('');
}

function applyOpts() {
  $('#keyBar').style.display = opts.keyBar ? 'flex' : 'none';
  saveSettings();
  updateCmdPrompt();
}

function applyTheme(t) {
  opts.theme = t;
  document.body.className = 'theme-' + t;
  saveSettings();
}

function toggleMenu(name) {
  if (menu) { closeMenu(); if (menu.name === name) return; }
  openMenu(name || 'Left');
}

function openMenu(name) {
  const items = MENUS[name];
  const itemEl = $(`.menu-item[data-menu="${name}"]`);
  if (!itemEl) return;
  const dd = el('div', 'dropdown');
  dd.dataset.menu = name;
  let cur = 0;
  const flatIdx = items.map((it, i) => it.sep ? -1 : i).filter(i => i >= 0);
  renderItems(dd, items, 0);
  itemEl.appendChild(dd);
  menu = { name, items, dd, cur, flatIdx, itemEl };
  itemEl.classList.add('open');
  paintMenu();
}
function closeMenu() {
  if (!menu) return;
  menu.itemEl.classList.remove('open');
  menu.dd.remove();
  menu = null;
}

function renderItems(dd, items, selIdx) {
  dd.innerHTML = '';
  items.forEach((it, i) => {
    if (it.sep) { dd.appendChild(el('div', 'sep')); return; }
    const row = el('div', 'mi' + (i === selIdx ? ' sel' : ''));
    row.dataset.i = i;
    const left = el('span');
    const hot = it.hot || it.label[0];
    const hi = it.label.indexOf(hot);
    left.innerHTML = `${esc(it.label.slice(0, hi))}<span class="hot">${esc(hot)}</span>${esc(it.label.slice(hi + 1))}`;
    row.appendChild(left);
    if (it.acc) row.appendChild(el('span', 'acc', it.acc));
    if (it.sub) row.appendChild(el('span', 'arr', '▶'));
    row.onclick = (ev) => { ev.stopPropagation(); menuItemPick(i); };
    row.onmouseenter = () => { menu.cur = menu.flatIdx.indexOf(i); paintMenu(); };
    dd.appendChild(row);
  });
}

function menuItemPick(i) {
  if (!menu) return;
  const it = menu.items[i];
  if (!it || it.sep) return;
  if (it.sub) { menu.cur = menu.flatIdx.indexOf(i); paintMenu(); return; }
  closeMenu();
  it.fn && it.fn();
}

function paintMenu() {
  if (!menu) return;
  $$('.submenu', menu.dd).forEach(s => s.remove());
  const items = menu.items;
  const idx = menu.flatIdx[menu.cur];
  $$('.mi', menu.dd).forEach(r => r.classList.toggle('sel', +r.dataset.i === idx));
  const it = items[idx];
  if (it && it.sub) {
    const host = $$('.mi', menu.dd).find(r => +r.dataset.i === idx);
    const sub = el('div', 'submenu');
    sub.dataset.sub = '1';
    let subCur = 0;
    const subIdx = it.sub.map((x, i) => x.sep ? -1 : i).filter(i => i >= 0);
    paintSub(sub, it.sub, subCur);
    host.appendChild(sub);
    menu.sub = { items: it.sub, subCur, subIdx, sub };
    menu.curSub = 0;
  } else {
    menu.sub = null;
  }
  const r = $$('.mi', menu.dd).find(x => +x.dataset.i === idx);
  if (r) r.scrollIntoView({ block: 'nearest' });
}
function paintSub(sub, items, selIdx) {
  sub.innerHTML = '';
  items.forEach((it, i) => {
    if (it.sep) { sub.appendChild(el('div', 'sep')); return; }
    const row = el('div', 'mi' + (i === selIdx ? ' sel' : ''));
    row.dataset.i = i;
    const hot = it.hot || it.label[0];
    const hi = it.label.indexOf(hot);
    row.innerHTML = `<span>${esc(it.label.slice(0, hi))}<span class="hot">${esc(hot)}</span>${esc(it.label.slice(hi + 1))}</span><span class="acc">${esc(it.acc || '')}</span>`;
    row.onclick = (ev) => { ev.stopPropagation(); const m = menu; if (m && m.sub) { const s = m.sub.items[i]; closeMenu(); s && s.fn && s.fn(); } };
    row.onmouseenter = () => { if (menu && menu.sub) { menu.sub.subCur = menu.sub.subIdx.indexOf(i); paintSub(menu.sub.sub, menu.sub.items, i); } };
    sub.appendChild(row);
  });
}

function menuKeys(e) {
  const m = menu;
  const items = m.items;
  const names = ['Left', 'Files', 'Commands', 'Options', 'Right'];
  if (e.key === 'Escape') { closeMenu(); return; }
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    const i = names.indexOf(m.name);
    const nxt = names[(i + (e.key === 'ArrowRight' ? 1 : names.length - 1)) % names.length];
    closeMenu();
    openMenu(nxt);
    return;
  }
  if (m.sub && e.key === 'ArrowLeft') { m.sub = null; $$('.submenu', m.dd).forEach(s => s.remove()); return; }
  if (m.sub) {
    if (e.key === 'ArrowDown') { m.sub.subCur = Math.min(m.sub.subIdx.length - 1, m.sub.subCur + 1); paintSub(m.sub.sub, m.sub.items, m.sub.subIdx[m.sub.subCur]); return; }
    if (e.key === 'ArrowUp') { m.sub.subCur = Math.max(0, m.sub.subCur - 1); paintSub(m.sub.sub, m.sub.items, m.sub.subIdx[m.sub.subCur]); return; }
    if (e.key === 'Enter') {
      const it = m.sub.items[m.sub.subIdx[m.sub.subCur]];
      closeMenu();
      it.fn && it.fn();
      return;
    }
    return;
  }
  if (e.key === 'ArrowDown') { m.cur = Math.min(m.flatIdx.length - 1, m.cur + 1); paintMenu(); return; }
  if (e.key === 'ArrowUp') { m.cur = Math.max(0, m.cur - 1); paintMenu(); return; }
  if (e.key === 'Enter') {
    const it = items[m.flatIdx[m.cur]];
    closeMenu();
    it.fn && it.fn();
    return;
  }
  // lettere calde
  const ch = e.key.toLowerCase();
  const it = items.find(x => !x.sep && (x.hot || x.label[0]).toLowerCase() === ch);
  if (it) { closeMenu(); it.fn && it.fn(); }
}

/* ------------------------------------------------------------------ */
/* F1..F10 e altri dialoghi                                            */
/* ------------------------------------------------------------------ */
function helpDlg() {
  openDlg(
    `<h1>Croc Commander — Aiuto</h1><div class="dlg-body"><div class="dlist" style="max-height:52vh">
      <div class="drow"><b>F1</b> Aiuto&nbsp;&nbsp; <b>F2</b> Modifica&nbsp;&nbsp; <b>F3</b> Vedi&nbsp;&nbsp; <b>F4</b> Info</div>
      <div class="drow"><b>F5</b> Invia file&nbsp;&nbsp; <b>F6</b> Ricevi file&nbsp;&nbsp; <b>F7</b> Codice&nbsp;&nbsp; <b>F8</b> Relay</div>
      <div class="drow"><b>F9</b> Menu a tendina&nbsp;&nbsp; <b>F10</b> Esci</div>
      <div class="drow"> </div>
      <div class="drow"><b>Tab</b> cambia pannello&nbsp;&nbsp; <b>Invio</b> apri&nbsp;&nbsp; <b>Backspace</b> su</div>
      <div class="drow"><b>Ins</b>/<b>Spazio</b> seleziona&nbsp;&nbsp; <b>+</b> gruppo&nbsp;&nbsp; <b>-</b> deseleziona&nbsp;&nbsp; <b>*</b> inverti</div>
      <div class="drow"><b>Alt+F1/F2</b> drive&nbsp;&nbsp; <b>Alt+F7</b> trova&nbsp;&nbsp; <b>Alt+F8</b> cronologia</div>
      <div class="drow"><b>Alt+Invio</b> info file&nbsp;&nbsp; <b>Alt+F5</b> invia&nbsp;&nbsp; <b>Alt+F6</b> ricevi</div>
      <div class="drow"> </div>
      <div class="drow"><b>Ctrl+F1..F3</b> Breve/Completo/Info&nbsp;&nbsp; <b>Ctrl+F5..F9</b> ordina</div>
      <div class="drow"><b>Ctrl+U</b> scambia&nbsp;&nbsp; <b>Ctrl+R</b> rileggi&nbsp;&nbsp; <b>Ctrl+P</b> copia percorso</div>
      <div class="drow"><b>Ctrl+Invio</b> nome su riga comando&nbsp;&nbsp; <b>Ctrl+\\</b> radice drive</div>
      <div class="drow"> </div>
      <div class="drow">La riga di comando esegue bash nella cartella attiva (Linux).</div>
      <div class="drow">Scrivi <b>croc send</b> o <b>croc recv</b> (oppure <b>invia</b>/<b>ricevi</b>) per trasferire con croc.</div>
      <div class="drow"> </div>
      <div class="drow dim">Trasferimenti via croc — https://github.com/schollz/croc</div>
      <div class="drow dim">Creato da ReverseLoo-Dev</div>
      <div class="drow dim" style="font-size:13px;font-weight:bold;color:var(--accent)">croc-ui.tuxlab.site</div>
    </div><div class="dlg-keys"><b>Esc</b>=chiudi</div></div>`,
    {}
  );
}
function quitDlg() {
  confirmDlg('Esci', 'Vuoi uscire da Croc Commander?', () => ncAPI.close());
}
function fileInfoDlg() {
  const panel = act();
  const e = currentEntry(panel);
  if (!e) return;
  const fp = p.join(panel.path, e.name);
  ncAPI.stat(fp).then(st => {
    openDlg(
      `<h1>Informazioni file</h1><div class="dlg-body">
        <div class="dlg-line">Nome:       ${esc(e.name)}</div>
        <div class="dlg-line">Percorso:   ${esc(fp)}</div>
        <div class="dlg-line">Dimensione: ${e.isDir ? '<DIR>' : fmtSize(e.size)}</div>
        <div class="dlg-line">Modificato: ${fmtDate(e.mtime)} ${fmtTime(e.mtime)}</div>
        <div class="dlg-line">Attributi:  ${esc(e.mode)}</div>
        <div class="dlg-line"> </div>
        <div class="dlg-line dim">Creato da ReverseLoo-Dev</div>
        <div class="dlg-line dim" style="font-size:13px;font-weight:bold;color:var(--accent);text-align:center;padding:4px 0">croc-ui.tuxlab.site</div>
        <div class="dlg-keys"><b>Esc</b>=chiudi</div>
      </div>`,
      {}
    );
  });
}
function sysInfoDlg() {
  ncAPI.osInfo().then(o => {
    openDlg(
      `<h1>Informazioni di sistema</h1><div class="dlg-body">
        <div class="dlg-line">Host:      ${esc(o.hostname)}  utente: ${esc(o.user)}</div>
        <div class="dlg-line">SO:        ${esc(o.platform)} ${esc(o.release)} (${esc(o.arch)})</div>
        <div class="dlg-line">CPU:       ${o.cpus} × ${esc(o.cpuModel)}</div>
        <div class="dlg-line">Memoria:   ${fmtSize(o.totalmem)} totale, ${fmtSize(o.freemem)} libera</div>
        <div class="dlg-line">Attivo:    ${Math.floor(o.uptime / 3600)}h ${Math.floor((o.uptime % 3600) / 60)}m</div>
        <div class="dlg-line">Home:      ${esc(o.home)}</div>
        <div class="dlg-line">Tmp:       ${esc(o.tmpdir)}</div>
        <div class="dlg-line"> </div>
        <div class="dlg-line dim">Creato da ReverseLoo-Dev</div>
        <div class="dlg-line dim" style="font-size:13px;font-weight:bold;color:var(--accent);text-align:center;padding:4px 0">croc-ui.tuxlab.site</div>
        <div class="dlg-keys"><b>Esc</b>=chiudi</div>
      </div>`,
      {}
    );
  });
}
function customCodeDlg() {
  inputDlg('Codice personalizzato', 'Codice per l\'invio (es. MIO-CODICE-123):', opts.customCode || '', (v) => {
    const c = v.trim().toUpperCase().replace(/\s+/g, '-');
    opts.customCode = c;
    saveSettings();
    toast(c ? 'Codice personalizzato: ' + c : 'Codice automatico riattivato');
  });
}
function relayLabel() { return opts.relay ? opts.relay : 'default (' + DEFAULT_RELAY + ')'; }
function relayDlg() {
  const d = openDlg(
    `<h1>Imposta relay</h1><div class="dlg-body">
      <div class="dlg-line">Relay attuale: <b>${esc(opts.relay || 'default (' + DEFAULT_RELAY + ')')}</b></div>
      <div class="dlg-line">Indirizzo (host:porta):</div>
      <input type="text" id="relay-addr" value="${esc(opts.relay || '')}" placeholder="es. relay.miosito.it:9009">
      <div class="dlg-line">Password relay (opzionale):</div>
      <input type="text" id="relay-pass" value="${esc(opts.relayPass || '')}">
      <div class="dlg-line dim">Lascia vuoto per usare il relay ufficiale di croc.</div>
      <div class="dlg-keys"><b>Invio</b>=salva&nbsp;&nbsp;<b>Del</b>=ripristina default&nbsp;&nbsp;<b>Esc</b>=annulla</div>
    </div>`,
    {
      keys(e) {
        if (e.key === 'Enter') {
          let addr = $('#relay-addr', d.el).value.trim();
          if (addr && !/:\d+$/.test(addr)) addr += ':9009';
          opts.relay = addr;
          opts.relayPass = $('#relay-pass', d.el).value.trim();
          saveSettings();
          closeDlg(d);
          toast(opts.relay ? 'Relay impostato: ' + opts.relay : 'Relay default ripristinato');
          return true;
        }
        if (e.key === 'Delete') {
          opts.relay = ''; opts.relayPass = '';
          saveSettings();
          closeDlg(d);
          toast('Relay default ripristinato');
          return true;
        }
        if (e.key === 'Escape') { closeDlg(d); return true; }
        return false;
      }
    }
  );
  setTimeout(() => { const a = $('#relay-addr', d.el); if (a) a.focus(); }, 10);
}

function shellDlg() {
  const d = openDlg(
    `<h1>Shell — bash (Linux)</h1><div class="dlg-body">
      <div class="log" id="sh-term" style="height:40vh"></div>
      <div style="display:flex;gap:1ch"><span id="sh-prompt" style="color:var(--yellow)"></span><input type="text" id="sh-in" style="flex:1"></div>
      <div class="dlg-keys"><b>Invio</b>=esegui&nbsp;&nbsp;<b>Esc</b>=chiudi</div>
    </div>`,
    { noEsc: true }
  );
  const log = $('#sh-term', d.el);
  const inp = $('#sh-in', d.el);
  const pr = $('#sh-prompt', d.el);
  let cwd = act().path;
  const put = (t) => { log.textContent += t; log.scrollTop = log.scrollHeight; };
  pr.textContent = cwd + '>';
  inp.focus();
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const cmd = inp.value.trim();
      inp.value = '';
      if (!cmd) return;
      put(cwd + '> ' + cmd + '\n');
      const myRun = { done: false };
      const consumer = (m) => { if (!myRun.done) put(m.chunk); };
      shellConsumer = consumer;
      ncAPI.exec({ cmd, cwd }).then(res => {
        myRun.done = true;
        put(`\n[uscita ${res.code}]\n`);
        const m = cmd.match(/^\s*cd\s+(.+)/);
        if (m) {
          let t = m[1].trim();
          if (t === '~') t = cwd.split('/').slice(0, 3).join('/');
          const np = t.startsWith('/') ? t : p.join(cwd, t);
          ncAPI.stat(np).then(st => { if (st && st.exists && st.isDirectory) { cwd = p.norm(np); pr.textContent = cwd + '>'; } });
        }
        inp.focus();
      });
    }
    if (e.key === 'Escape') { closeDlg(d); }
  });
}

/* ------------------------------------------------------------------ */
/* Drive / ricerca / cronologia                                        */
/* ------------------------------------------------------------------ */
async function drivesDlg(panel) {
  const drives = await ncAPI.drives().catch(() => []);
  if (!drives.length) { toast('Nessun drive trovato'); return; }
  const items = drives.map(dr => ({ html: `<b>${esc(dr.label)}</b> &nbsp;${esc(dr.path)} &nbsp;<span class="dim">${fmtSize(dr.free)} liberi</span>`, dr }));
  listDlg(`Drive — pannello ${panel.id === 'left' ? 'sinistro' : 'destro'}`, items, (it) => {
    cd(panel, it.dr.path);
  });
}

function searchDlg() {
  const panel = act();
  const cur = currentEntry(panel);
  const defPatt = cur && !cur.isDir ? '*' + extOf(cur.name) || '*' : '*';
  inputDlg('Trova file', 'Maschera (es. *.txt):', defPatt, (patt) => {
    inputDlg('Trova file', 'Da:', panel.path, (root) => {
      const d = openDlg(`<h1>Ricerca…</h1><div class="dlg-body"><div class="dlg-line">Scansione di ${esc(root)} per ${esc(patt)}</div></div>`, {});
      ncAPI.search({ root: p.norm(root), pattern: patt.trim() || '*' }).then(res => {
        closeDlg(d);
        const items = res.results.map(r => ({ html: `<b>${esc(r.name)}</b> <span class="dim">${esc(p.dir(r.path))}</span>`, r }));
        if (!items.length) { toast('Nessun file trovato'); return; }
        listDlg(`Trova — ${res.results.length} risultato${res.results.length === 1 ? '' : 'i'}${res.truncated ? ' (troncato)' : ''}`, items, (it) => {
          cd(panel, p.dir(it.r.path));
          setTimeout(() => {
            const idx = (panel._rows || []).findIndex(e => e.name === it.r.name);
            if (idx >= 0) { panel.selected.add(it.r.name); panel.cursor = idx; renderPanel(panel.id); }
          }, 250);
        });
      }).catch(() => toast('Ricerca non riuscita'));
    });
  });
}

function historyDlg() {
  const panel = act();
  const items = panel.history.slice().reverse().map(h => ({ html: `<b>${esc(h)}</b>`, h }));
  if (!items.length) { toast('Nessuna cronologia'); return; }
  listDlg('Cronologia cartelle', items, (it) => cd(panel, it.h));
}

/* ------------------------------------------------------------------ */
/* Visualizzatore / editor                                             */
/* ------------------------------------------------------------------ */
function currentFilePath() {
  const panel = act();
  const e = currentEntry(panel);
  if (!e || e.isDir || e.name === '.' || e.name === '..') return null;
  return p.join(panel.path, e.name);
}

function viewCurrent() {
  const fp = currentFilePath();
  if (!fp) return;
  if (IMAGE_EXT.test(fp)) { openImageViewer(fp); return; }
  openViewer(fp);
}
function editCurrent() {
  const fp = currentFilePath();
  if (fp) openEditor(fp);
}

function openImageViewer(fp) {
  const s = el('div', 'fscreen');
  s.innerHTML = `<div class="fhead" id="vi-head"></div><div class="fbody" id="vi-body" style="display:flex;align-items:center;justify-content:center;background:#111"><div id="vi-load">Caricamento…</div></div>
    <div class="fkeybar"><div class="fkey"><span class="n">10</span> <span class="lbl">Esci</span></div></div>`;
  document.body.appendChild(s);
  const head = $('#vi-head', s), body = $('#vi-body', s);
  ncAPI.readImage(fp).then(r => {
    if (r.ok) {
      const img = new Image();
      img.onload = () => {
        head.textContent = fp + '  —  ' + fmtSize(r.size) + '  (' + img.naturalWidth + '\u00d7' + img.naturalHeight + ' px)';
        body.innerHTML = '';
        body.appendChild(img);
      };
      img.onerror = () => {
        head.textContent = 'Errore: immagine non valida';
        body.innerHTML = '<div style="color:var(--error)">Impossibile decodificare l\'immagine</div>';
      };
      img.src = 'data:' + r.mime + ';base64,' + r.data;
      img.style.maxWidth = '95%';
      img.style.maxHeight = '88vh';
      img.style.objectFit = 'contain';
      img.style.border = '2px solid var(--border)';
      img.style.borderRadius = '4px';
    } else {
      head.textContent = 'Errore: ' + r.error;
      body.innerHTML = '<div style="color:var(--error)">' + r.error + '</div>';
    }
  }).catch(err => { head.textContent = 'Errore'; body.innerHTML = '<div style="color:var(--error)">' + err.message + '</div>'; });
  screen = {
    kind: 'image',
    keys(e) {
      if (e.key === 'Escape' || e.key === 'Enter' || e.key === 'F10') { s.remove(); screen = null; return true; }
      return true;
    }
  };
}

function openViewer(fp) {
  let mode = 'text', lines = [], off = 0, q = '';
  const s = el('div', 'fscreen');
  s.innerHTML = `<div class="fhead" id="v-head"></div><div class="fbody" id="v-body"><pre id="v-pre"></pre></div>
    <div class="fkeybar"><div class="fkey"><span class="n">2</span> <span class="lbl">Esa</span></div><div class="fkey"><span class="n">7</span> <span class="lbl">Cerca</span></div><div class="fkey"><span class="n">9</span> <span class="lbl">A-capo</span></div><div class="fkey"><span class="n">10</span> <span class="lbl">Esci</span></div></div>`;
  document.body.appendChild(s);
  const pre = $('#v-pre', s), head = $('#v-head', s), body = $('#v-body', s);
  let wrap = false;
  const setHead = () => { head.textContent = `${fp}  —  ${mode === 'hex' ? 'ESADECIMALE' : 'TESTO'}  (${fmtSize(fileSize)} byte)  ${q ? 'ricerca: ' + q : ''}`; };

  let fileSize = 0, hexRows = [];
  const ROWS = 400;

  function renderText() {
    const slice = lines.slice(off, off + ROWS);
    pre.textContent = slice.join('\n');
    pre.style.whiteSpace = wrap ? 'pre-wrap' : 'pre';
  }
  function renderHex() {
    pre.textContent = hexRows.slice(off, off + ROWS).join('\n');
    pre.style.whiteSpace = 'pre';
  }
  function paint() {
    if (mode === 'hex') renderHex(); else renderText();
    body.scrollTop = 0;
    setHead();
  }
  function findNext(from) {
    const hay = q.toLowerCase();
    if (mode === 'hex') {
      for (let i = from; i < hexRows.length; i++) if (hexRows[i].toLowerCase().includes(hay)) return i;
      return -1;
    }
    for (let i = from; i < lines.length; i++) if (lines[i].toLowerCase().includes(hay)) return i;
    return -1;
  }

  const buildHex = (h) => {
    if (!h || !h.ok) return;
    const rows = [];
    for (let i = 0; i < h.hex.length; i += 32) {
      const chunk = h.hex.slice(i, i + 32);
      let ascii = '';
      for (let j = 0; j < chunk.length; j += 2) {
        const c = parseInt(chunk.slice(j, j + 2), 16);
        ascii += (c >= 32 && c < 127) ? String.fromCharCode(c) : '.';
      }
      const offStr = (i / 2).toString(16).padStart(8, '0');
      rows.push(offStr + '  ' + (chunk.match(/.{2}/g) || []).join(' ').padEnd(48) + ' |' + ascii + '|');
    }
    hexRows = rows;
    if (h.shown < h.size) hexRows.push('… (mostrati i primi ' + h.shown + ' di ' + h.size + ' byte)');
  };

  ncAPI.read(fp).then(r => {
    fileSize = r.size || 0;
    if (r.ok && !r.binary) { lines = r.text.split('\n'); if (lines.length > 60000) lines = lines.slice(0, 60000).concat(['… (file troncato)']); mode = 'text'; }
    else {
      mode = 'hex';
      ncAPI.readHex(fp).then(h => { buildHex(h); paint(); });
      return;
    }
    paint();
  });

  screen = {
    kind: 'view',
    keys(e) {
      const k = e.key;
      const total = mode === 'hex' ? hexRows.length : lines.length;
      if (k === 'F2') {
        const next = mode === 'hex' ? 'text' : 'hex';
        mode = next;
        if (mode === 'hex' && !hexRows.length) { ncAPI.readHex(fp).then(h => { buildHex(h); paint(); }); e.preventDefault(); return; }
        paint();
        e.preventDefault();
        return;
      }
      if (k === 'F7') { q = prompt2('Cerca:', q, (v) => { q = v; const i = findNext(0); if (i >= 0) { off = Math.max(0, i - 2); paint(); } else toast('Non trovato'); }); e.preventDefault(); return; }
      if (k === 'F9') { wrap = !wrap; paint(); e.preventDefault(); return; }
      if (k === 'ArrowDown') { off = Math.min(total - 1, off + 1); paint(); e.preventDefault(); return; }
      if (k === 'ArrowUp') { off = Math.max(0, off - 1); paint(); e.preventDefault(); return; }
      if (k === 'PageDown') { off = Math.min(total - 1, off + ROWS); paint(); e.preventDefault(); return; }
      if (k === 'PageUp') { off = Math.max(0, off - ROWS); paint(); e.preventDefault(); return; }
      if (k === 'Home') { off = 0; paint(); e.preventDefault(); return; }
      if (k === 'End') { off = Math.max(0, total - ROWS); paint(); e.preventDefault(); return; }
      if (k === 'Escape' || k === 'Enter' || k === 'F10') { s.remove(); screen = null; return true; }
      return true;
    }
  };
}

function prompt2(label, def, onOk) {
  const d = openDlg(
    `<h1>${esc(label)}</h1><div class="dlg-body"><input type="text" value="${esc(def || '')}"></div>`,
    { keys(e) { if (e.key === 'Enter') { const v = $('input', d.el).value; closeDlg(d); onOk(v); return true; } if (e.key === 'Escape') { closeDlg(d); return true; } return false; } }
  );
}

function openEditor(fp) {
  let dirty = false;
  const s = el('div', 'fscreen');
  s.innerHTML = `<div class="fhead" id="e-head"></div><textarea id="e-area" spellcheck="false"></textarea>
    <div class="fkeybar"><div class="fkey"><span class="n">2</span> <span class="lbl">Salva</span></div><div class="fkey"><span class="n">7</span> <span class="lbl">Cerca</span></div><div class="fkey"><span class="n">10</span> <span class="lbl">Salva&amp;Esci</span></div><div class="fkey"><span class="n">Esc</span> <span class="lbl">Esci</span></div></div>`;
  document.body.appendChild(s);
  const area = $('#e-area', s), head = $('#e-head', s);
  const mark = () => { head.textContent = `${fp}  ${dirty ? '*modificato*' : ''}`; };
  mark();
  area.addEventListener('input', () => { if (!dirty) { dirty = true; mark(); } });

  ncAPI.read(fp).then(r => {
    if (!r.ok) { area.value = ''; if (r.error && !/ENOENT/.test(r.error)) toast('Impossibile leggere: ' + r.error); }
    else area.value = r.text;
    area.focus();
  });

  const save = () => ncAPI.write({ p: fp, content: area.value }).then(res => {
    if (res.ok) { dirty = false; mark(); toast('Salvato'); }
    else toast('Errore di salvataggio: ' + res.error);
  });
  const close = () => { s.remove(); screen = null; };

  screen = {
    kind: 'edit',
    keys(e) {
      const k = e.key;
      if (k === 'F2' || (e.ctrlKey && (k === 's' || k === 'S'))) { e.preventDefault(); save(); return; }
      if (k === 'F10') { e.preventDefault(); save().then(close); return; }
      if (k === 'F7') { e.preventDefault(); prompt2('Cerca:', '', (v) => { if (!v) return; const i = area.value.toLowerCase().indexOf(v.toLowerCase()); if (i >= 0) { area.focus(); area.setSelectionRange(i, i + v.length); } else toast('Non trovato'); }); return; }
      if (k === 'Escape') {
        e.preventDefault();
        if (dirty) confirmDlg('Editor', 'Salvare le modifiche prima di uscire?', () => save().then(close), {});
        else close();
        return;
      }
      if (area === document.activeElement && k.length === 1) return; // lascia digitare alla textarea
      return true;
    }
  };
}

/* ------------------------------------------------------------------ */
/* Invia / ricevi con croc                                             */
/* ------------------------------------------------------------------ */
class CrocLog {
  constructor(max = 400) { this.lines = []; this.current = ''; this.max = max; }
  push(chunk) {
    const clean = chunk.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '').replace(/\x1b[()][0-9A-Z]/g, '');
    for (const ch of clean) {
      if (ch === '\r') this.current = '';
      else if (ch === '\n') this.commit();
      else this.current += ch;
    }
    this.commit();
  }
  commit() {
    const line = this.current.trim();
    this.current = '';
    if (!line) return;
    if (/^\d{1,3}%\s*\|/.test(line) || /[█▉▊▋▌▍▎▏▁▂▃▄▅▆▇]/.test(line)) { if (!/100%/.test(line)) return; }
    this.lines.push(line);
    if (this.lines.length > this.max) this.lines.splice(0, this.lines.length - this.max);
  }
  render() { this.commit(); return this.lines.join('\n'); }
}
function parsePct(text) {
  const m = text.match(/(\d{1,3})%/g);
  if (!m) return null;
  return parseInt(m[m.length - 1], 10);
}

function crocSendDlg(files) {
  if (!files || !files.length) { toast('Seleziona prima i file (Ins/Spazio o *)'); return; }
  let running = false, done = false;
  let custom = !!opts.customCode;
  let code = custom ? opts.customCode : '';
  const codePlaceholder = custom ? opts.customCode : 'Attendi invio…';
  const log = new CrocLog();
  const d = openDlg(
    `<h1>Invia file con croc</h1><div class="dlg-body">
      <div class="dlg-line">${esc(files.map(f => p.base(f)).join(', ').slice(0, 80))}${files.length > 1 ? `  (${files.length} file)` : ''}</div>
      <div class="dlg-line"><span class="lbl">Codice:</span> <span class="big-code" id="c-send-code">${esc(codePlaceholder)}</span></div>
      <div class="dlg-line"><span class="lbl">Codice personalizzato:</span> <input type="text" id="c-send-custom" value="${esc(opts.customCode || '')}" style="display:${custom ? 'block' : 'none'}" placeholder="lascia vuoto per automatico"></div>
      <div class="dlg-line dim"><span class="lbl">Relay:</span> ${esc(relayLabel())}</div>
      <div class="progress-wrap" id="c-send-prog-wrap" style="display:none">
        <div class="prog-bar" id="c-send-bar">0%</div>
        <div class="prog-text" id="c-send-pct"></div>
      </div>
      <div class="log" id="c-send-log" style="display:none"></div>
      <div class="dlg-keys" id="c-send-keys"><b>F2</b>=personalizza codice&nbsp;&nbsp;<b>Invio</b>=Invia&nbsp;&nbsp;<b>Esc</b>=chiudi</div>
    </div>`,
    {
      keys(e) {
        if (e.key === 'F2') {
          const inp = $('#c-send-custom', d.el);
          inp.style.display = 'block';
          custom = true;
          inp.value = code;
          inp.focus();
          return true;
        }
        if (e.key === 'Enter') { if (!running && !done) start(); return true; }
        if (e.key === 'Escape') { if (running) ncAPI.crocCancel(); closeDlg(d); return true; }
        return false;
      }
    }
  );
  const codeEl = $('#c-send-code', d.el), custEl = $('#c-send-custom', d.el), logEl = $('#c-send-log', d.el),
    barEl = $('#c-send-bar', d.el), pctEl = $('#c-send-pct', d.el), wrapEl = $('#c-send-prog-wrap', d.el), keysEl = $('#c-send-keys', d.el);

  const onCode = (c) => { if (c && !custom) { code = c; codeEl.textContent = c; } };
  const onProgress = (t) => {
    const pct = parsePct(t);
    if (pct !== null) { barEl.textContent = pct + '%'; pctEl.textContent = t.replace(/\x1b\[[0-9;]*m/g, '').trim(); }
    log.push(t); logEl.textContent = log.render(); logEl.scrollTop = logEl.scrollHeight;
  };
  const onOutput = (t) => { log.push(t); logEl.textContent = log.render(); logEl.scrollTop = logEl.scrollHeight; };
  const onPrompt = (pd) => confirmDlg('croc', pd.text + '\n\nRispondere?', () => ncAPI.crocAnswer(true), { onNo: () => ncAPI.crocAnswer(false) });
  const wire = () => { crocBus.code = onCode; crocBus.progress = onProgress; crocBus.output = onOutput; crocBus.prompt = onPrompt; };
  const unwire = () => { crocBus.code = crocBus.progress = crocBus.output = crocBus.prompt = null; };

  function start() {
    running = true;
    wrapEl.style.display = 'block';
    logEl.style.display = 'block';
    keysEl.innerHTML = '<b>Esc</b>=annulla';
    wire();
    const customCode = custom ? custEl.value.trim() || undefined : undefined;
    ncAPI.crocSend({ files, customCode, relay: opts.relay, relayPass: opts.relayPass })
      .then(res => {
        running = false; done = true;
        if (!custom) { code = res.code || code; codeEl.textContent = code; }
        keysEl.innerHTML = '<b>C</b>=copia codice&nbsp;&nbsp;<b>Invio</b>=chiudi';
        pctEl.textContent = 'Invio riuscito.';
        toast('File inviati — codice: ' + code);
      })
      .catch(err => {
        running = false; done = true;
        keysEl.innerHTML = '<b>Invio</b>=chiudi';
        pctEl.textContent = 'Errore: ' + err.message.split('\n')[0];
        logEl.textContent = (log.render() + '\n' + err.message).slice(-2000);
      });
  }
  const origKeys = d.keys;
  d.keys = (e) => {
    if (done) {
      if (e.key === 'c' || e.key === 'C') { ncAPI.clipboardWrite(code); toast('Codice copiato'); return true; }
      if (e.key === 'Enter' || e.key === 'Escape') { closeDlg(d); return true; }
      return false;
    }
    return origKeys(e);
  };
  d.onClose = () => { if (running) ncAPI.crocCancel(); unwire(); };
}

function crocRecvDlg(prefillCode) {
  let running = false, done = false;
  let dir = '';
  const log = new CrocLog();
  ncAPI.home().then(h => { dir = h + '/Downloads'; const el = $('#c-recv-dir', d.el); if (el) el.textContent = dir; });
  const d = openDlg(
    `<h1>Ricevi file con croc</h1><div class="dlg-body">
      <div class="dlg-line"><span class="lbl">Codice:</span> <input type="text" id="c-recv-code" value="${esc(prefillCode || '')}" placeholder="AAAA-BBBB-CCCC"></div>
      <div class="dlg-line"><span class="lbl">Salva in:</span> <span id="c-recv-dir">…</span> &nbsp;[<b>F2</b> cambia]</div>
      <div class="dlg-line dim"><span class="lbl">Relay:</span> ${esc(relayLabel())}</div>
      <div class="progress-wrap" id="c-recv-prog-wrap" style="display:none">
        <div class="prog-bar" id="c-recv-bar">0%</div>
        <div class="prog-text" id="c-recv-pct"></div>
      </div>
      <div class="log" id="c-recv-log" style="display:none"></div>
      <div class="dlg-keys" id="c-recv-keys"><b>Invio</b>=Ricevi&nbsp;&nbsp;<b>Esc</b>=chiudi</div>
    </div>`,
    {
      keys(e) {
        if (e.key === 'F2') {
          ncAPI.pickSaveDir().then(p2 => { if (p2) { dir = p2; $('#c-recv-dir', d.el).textContent = dir; } });
          return true;
        }
        if (e.key === 'Enter') { if (!running && !done) start(); return true; }
        if (e.key === 'Escape') { if (running) ncAPI.crocCancel(); closeDlg(d); return true; }
        return false;
      }
    }
  );
  const codeInp = $('#c-recv-code', d.el), logEl = $('#c-recv-log', d.el),
    barEl = $('#c-recv-bar', d.el), pctEl = $('#c-recv-pct', d.el), wrapEl = $('#c-recv-prog-wrap', d.el), keysEl = $('#c-recv-keys', d.el);
  const onProgress = (t) => {
    const pct = parsePct(t);
    if (pct !== null) { barEl.textContent = pct + '%'; pctEl.textContent = t.replace(/\x1b\[[0-9;]*m/g, '').trim(); }
    log.push(t); logEl.textContent = log.render(); logEl.scrollTop = logEl.scrollHeight;
  };
  const onOutput = (t) => { log.push(t); logEl.textContent = log.render(); logEl.scrollTop = logEl.scrollHeight; };
  const onPrompt = (pd) => confirmDlg('croc', pd.text + '\n\nRispondere?', () => ncAPI.crocAnswer(true), { onNo: () => ncAPI.crocAnswer(false) });
  const wire = () => { crocBus.progress = onProgress; crocBus.output = onOutput; crocBus.prompt = onPrompt; };
  const unwire = () => { crocBus.progress = crocBus.output = crocBus.prompt = null; };

  function start() {
    const c = codeInp.value.trim();
    if (!c) { toast('Inserisci il codice croc'); return; }
    running = true;
    wrapEl.style.display = 'block';
    logEl.style.display = 'block';
    keysEl.innerHTML = '<b>Esc</b>=annulla';
    wire();
    ncAPI.crocReceive({ code: c, outputDir: dir, relay: opts.relay, relayPass: opts.relayPass })
      .then(res => {
        running = false; done = true;
        keysEl.innerHTML = '<b>G</b>=vai alla cartella&nbsp;&nbsp;<b>Invio</b>=chiudi';
        pctEl.textContent = 'Ricevuto in ' + res.dir;
        toast('Ricevuto in ' + res.dir);
      })
      .catch(err => {
        running = false; done = true;
        keysEl.innerHTML = '<b>Invio</b>=chiudi';
        pctEl.textContent = 'Errore: ' + err.message.split('\n')[0];
        logEl.textContent = (log.render() + '\n' + err.message).slice(-2000);
      });
  }
  const origKeys = d.keys;
  d.keys = (e) => {
    if (done) {
      if (e.key === 'g' || e.key === 'G') { closeDlg(d); cd(act(), dir); return true; }
      if (e.key === 'Enter' || e.key === 'Escape') { closeDlg(d); return true; }
      return false;
    }
    return origKeys(e);
  };
  d.onClose = () => { if (running) ncAPI.crocCancel(); unwire(); };
}

/* ------------------------------------------------------------------ */
/* Mouse: click / doppio click / barra tasti                           */
/* ------------------------------------------------------------------ */
function bindMouse() {
  ['left', 'right'].forEach(id => {
    const list = $('#list-' + id);
    list.addEventListener('mousedown', (ev) => {
      const row = ev.target.closest('.row');
      if (row) {
        const panel = P[id];
        setActive(id);
        const idx = +row.dataset.idx;
        if (idx >= 0 && idx !== panel.cursor) { panel.cursor = idx; renderPanel(id); }
      }
    });
    list.addEventListener('dblclick', (ev) => {
      const row = ev.target.closest('.row');
      if (!row) return;
      const panel = P[id];
      setActive(id);
      panel.cursor = +row.dataset.idx;
      enterCurrent();
    });
  });

  // barra tasti funzione (click)
  $$('#keyBar .fkey').forEach(fk => {
    fk.onclick = () => {
      const n = fk.dataset.f;
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F' + n, bubbles: true }));
    };
  });
}

/* ------------------------------------------------------------------ */
/* Bindings barra menu                                                 */
/* ------------------------------------------------------------------ */
function bindMenuBar() {
  $$('#menuBar .menu-item').forEach(mi => {
    mi.onclick = () => toggleMenu(mi.dataset.menu);
    mi.onmouseenter = () => { if (menu && menu.name !== mi.dataset.menu) toggleMenu(mi.dataset.menu); };
  });
}

/* ------------------------------------------------------------------ */
/* Bindings riga comando                                               */
/* ------------------------------------------------------------------ */
function bindCmd() {
  const inp = $('#cmdInput');
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); execCmd(inp.value); }
    else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (cmdHist.length) { cmdHistIdx = cmdHistIdx < 0 ? cmdHist.length - 1 : Math.max(0, cmdHistIdx - 1); inp.value = cmdHist[cmdHistIdx]; }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (cmdHistIdx >= 0) { cmdHistIdx++; inp.value = cmdHistIdx < cmdHist.length ? cmdHist[cmdHistIdx] : ''; }
    } else if (e.key === 'Escape') { e.preventDefault(); inp.value = ''; inp.blur(); }
  });
}

function updateCmdPrompt() {
  const inp = $('#cmdInput');
  const path = opts.pathPrompt ? act().path : '';
  $('#cmdPrompt').textContent = path + '>';
  inp.placeholder = 'digita comando o nome…';
}

/* ------------------------------------------------------------------ */
/* Apri la voce corrente                                               */
/* ------------------------------------------------------------------ */
function enterCurrent() {
  const panel = act();
  const e = currentEntry(panel);
  if (!e) return;
  if (e.name === '.' || e.name === '..') {
    if (e.name === '..') parentOf(panel);
    return;
  }
  const fp = p.join(panel.path, e.name);
  if (e.isDir) { cd(panel, fp); return; }
  if (TEXT_EXT.test(e.name)) { openViewer(fp); return; }
  if (IMAGE_EXT.test(e.name)) { openImageViewer(fp); return; }
  ncAPI.openPath(fp);
}

/* ------------------------------------------------------------------ */
/* Init                                                                */
/* ------------------------------------------------------------------ */
let MENUS = null;
async function init() {
  loadSettings();
  applyTheme(opts.theme);
  buildKeyBar();
  applyOpts();
  MENUS = buildMenuData();
  bindMenuBar();
  bindCmd();
  bindMouse();

  const home = await ncAPI.home().catch(() => '/');
  if (!P.left.path || P.left.path === '/') P.left.path = home;
  if (!P.right.path || P.right.path === '/') P.right.path = home;

  updateCmdPrompt();
  $('#cmdInput').addEventListener('blur', updateCmdPrompt);

  await Promise.all([loadDir(P.left, false), loadDir(P.right, false)]);
  renderPanels();
  updateCmdPrompt();
  saveSettings();

  // badge versione croc
  ncAPI.crocVersion().then(v => {
    if (v && !/not found|non trovato/i.test(v)) { /* croc disponibile */ }
    else toast('croc non trovato — installalo per i trasferimenti (github.com/schollz/croc)', 5000);
  });

  // statistiche disco aggiornate
  setInterval(() => {
    if (!dlgStack.length && !screen) {
      const panel = act();
      ncAPI.disk(panel.path).then(d => { if (d) { panel.disk = d; const f = $('#foot-' + panel.id); if (f) f.innerHTML = `<div>${esc(panel.path)}&nbsp;&nbsp;file: ${panel.entries.length}  selezionati: ${panel.selected.size}</div><div class="dim">${fmtSize(d.free)} liberi di ${fmtSize(d.total)}</div>`; } });
    }
  }, 15000);
}

window.addEventListener('DOMContentLoaded', init);
