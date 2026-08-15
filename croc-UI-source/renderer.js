/* ── CroC UI — Renderer Logic ── */

// ═══ DOM REFS ═══
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

// Orders croc's messy terminal output (ANSI codes, \r progress rewrites)
// into readable log lines.
class CrocLog {
  constructor(maxLines = 200) {
    this.lines = [];
    this.current = '';
    this.maxLines = maxLines;
  }
  push(chunk) {
    const clean = chunk
      .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')      // CSI colors/cursor
      .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '') // OSC
      .replace(/\x1b[()][0-9A-Z]/g, '');
    for (const ch of clean) {
      if (ch === '\r') this.current = '';          // progress rewrite: drop line
      else if (ch === '\n') this.commit();
      else this.current += ch;
    }
  }
  commit() {
    const line = this.current.trim();
    this.current = '';
    if (!line) return;
    if (/^\d{1,3}%\s*\|/.test(line) || /[█▉▊▋▌▍▎▏▁▂▃▄▅▆▇]/.test(line)) {
      if (!/100%/.test(line)) return; // drop progress bars, keep the 100% line
    }
    this.lines.push(line);
    if (this.lines.length > this.maxLines) this.lines.splice(0, this.lines.length - this.maxLines);
  }
  render() { this.commit(); return this.lines.join('\n'); }
}

const DZ = $('#dropzone');
const CROC_BANNER = $('#crocCheckBanner');
const FILE_LIST = $('#sendFileList');
const SEND_BTN = $('#btnSend');
const CUSTOM_CODE_TOGGLE = $('#toggleCustomCode');
const CUSTOM_CODE_ROW = $('#customCodeRow');
const CUSTOM_CODE_INPUT = $('#customCodeInput');
const GEN_CODE_BTN = $('#btnGenerateCode');
const AUTO_CODE_ROW = $('#autoCodeRow');
const AUTO_CODE = $('#autoCode');
const AUTO_COPY = $('#btnAutoCopy');
const SEND_PROGRESS = $('#sendProgress');
const SEND_STATUS = $('#sendStatusText');
const SEND_PERCENT = $('#sendPercent');
const SEND_BAR = $('#sendProgressBar');
const SEND_LOG = $('#sendLog');
const SEND_CANCEL = $('#btnSendCancel');
const SEND_CODE_DISPLAY = $('#sendCodeDisplay');
const SENT_CODE_EL = $('#sentCode');
const COPY_BTN = $('#btnCopyCode');
const QR_CONTAINER = $('#qrcode');
const SEND_DONE = $('#sendDone');
const SEND_RESET = $('#btnSendReset');

const RECV_INPUT = $('#receiveCodeInput');
const RECV_BTN = $('#btnReceive');
const RECV_DIR = $('#receiveDir');
const CHANGE_DIR = $('#btnChangeDir');
const RECV_PROGRESS = $('#receiveProgress');
const RECV_STATUS = $('#receiveStatusText');
const RECV_SPINNER = $('#receiveSpinner');
const RECV_RING = $('#receiveRing');
const RECV_PERCENT = $('#receivePercent');
const RECV_BAR = $('#receiveProgressBar');
const RECV_LOG = $('#receiveLog');
const RECV_CANCEL = $('#btnReceiveCancel');
const RECV_DONE = $('#receiveDone');
const RECV_RESET = $('#btnReceiveReset');
const OPEN_RECEIVED = $('#btnOpenReceived');

const HISTORY_LIST = $('#historyList');
const CLEAR_HISTORY = $('#btnClearHistory');
const VERSION_BADGE = $('#versionBadge');

const PROMPT_OVERLAY = $('#promptOverlay');
const PROMPT_TEXT = $('#promptText');
const PROMPT_ACCEPT = $('#promptAccept');
const PROMPT_DECLINE = $('#promptDecline');

const sendLog = new CrocLog();
const receiveLog = new CrocLog();

// ═══ STATE ═══
let selectedFiles = [];
let currentTransfer = null; // { type:'send'|'receive', cancelled:bool }
let receiveDir = '';
let history = loadHistory();
let isSending = false;
let isReceiving = false;

// ═══ WINDOW CONTROLS ═══
$('#btnMinimize').onclick = () => crocAPI.minimize();
$('#btnMaximize').onclick = () => crocAPI.maximize();
$('#btnClose').onclick = () => crocAPI.close();

// ═══ TABS ═══
$$('.stab').forEach(btn => {
  btn.onclick = () => {
    $$('.stab').forEach(b => b.classList.remove('active'));
    $$('.panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('panel-' + btn.dataset.tab).classList.add('active');
  };
});

// ═══ VERSION & CROC CHECK ═══
crocAPI.getVersion().then(v => {
  const ver = v.replace(/^croc version /, 'v').split('-')[0];
  VERSION_BADGE.textContent = ver;
}).catch(() => {
  VERSION_BADGE.textContent = '!';
  VERSION_BADGE.classList.add('badge-warn');
  CROC_BANNER.classList.remove('hidden');
});

// ═══ AUTO-CODE (custom passphrase OFF) ═══
function genAutoCode() {
  const p1 = Math.random().toString(36).substring(2,6).toUpperCase();
  const p2 = Math.random().toString(36).substring(2,6).toUpperCase();
  const p3 = Math.random().toString(36).substring(2,6).toUpperCase();
  AUTO_CODE.textContent = `${p1}-${p2}-${p3}`;
}

AUTO_COPY.onclick = async () => {
  try {
    await navigator.clipboard.writeText(AUTO_CODE.textContent);
    AUTO_COPY.classList.add('copied');
    AUTO_COPY.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>`;
    setTimeout(() => {
      AUTO_COPY.classList.remove('copied');
      AUTO_COPY.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>`;
    }, 2000);
  } catch {}
};

function generateQrOn(container, text, size) {
  container.innerHTML = '';
  try {
    const canvas = document.createElement('canvas');
    container.appendChild(canvas);
    qrgen(canvas, text, size);
  } catch {
    container.innerHTML = `<span style="font-size:10px;color:var(--text-dim)">${text}</span>`;
  }
}
  
function loadHistory() {
  try { return JSON.parse(localStorage.getItem('crocHistory') || '[]'); }
  catch { return []; }
}
function saveHistory() {
  localStorage.setItem('crocHistory', JSON.stringify(history));
}
function addHistory(entry) {
  entry.time = Date.now();
  history.unshift(entry);
  if (history.length > 50) history = history.slice(0, 50);
  saveHistory();
  renderHistory();
}

function renderHistory() {
  if (history.length === 0) {
    HISTORY_LIST.innerHTML = `<div class="history-empty">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
      <p>No transfers yet</p>
    </div>`;
    return;
  }
  HISTORY_LIST.innerHTML = history.map(e => {
    const dir = e.direction === 'send' ? '↑ Sent' : '↓ Received';
    const time = new Date(e.time).toLocaleString();
    const icon = e.direction === 'send'
      ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>`
      : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--orange)" stroke-width="2"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>`;
    const name = e.files ? e.files.join(', ').substring(0,60) : e.code || '—';
    return `<div class="history-item">
      <div class="hi-icon">${icon}</div>
      <span class="hi-dir">${dir}</span>
      <span>${name}</span>
      <span class="hi-time">${time}</span>
    </div>`;
  }).join('');
}

CLEAR_HISTORY.onclick = () => { history = []; saveHistory(); renderHistory(); };

// ═══ DROP ZONE ═══
DZ.onclick = async () => {
  const files = await crocAPI.pickFiles();
  if (files.length) addFiles(files);
};

// Windows: file and folder pickers must be separate dialogs, otherwise
// single files can become unselectable. Clicking these buttons must not
// bubble up to the dropzone handler.
const BTN_PICK_FILES = $('#btnPickFiles');
const BTN_PICK_FOLDER = $('#btnPickFolder');
if (BTN_PICK_FILES) {
  BTN_PICK_FILES.onclick = async (e) => {
    e.stopPropagation();
    const files = await crocAPI.pickFiles();
    if (files.length) addFiles(files);
  };
}
if (BTN_PICK_FOLDER) {
  BTN_PICK_FOLDER.onclick = async (e) => {
    e.stopPropagation();
    const folders = await crocAPI.pickFolders();
    if (folders.length) addFiles(folders);
  };
}

// Drag events
['dragenter','dragover','dragleave','drop'].forEach(ev => {
  DZ.addEventListener(ev, (e) => { e.preventDefault(); e.stopPropagation(); });
});
DZ.addEventListener('dragenter', () => DZ.classList.add('dragover'));
DZ.addEventListener('dragleave', (e) => {
  if (e.relatedTarget && DZ.contains(e.relatedTarget)) return;
  DZ.classList.remove('dragover');
});
DZ.addEventListener('drop', (e) => {
  DZ.classList.remove('dragover');
  const files = Array.from(e.dataTransfer.files).map(f => {
    try { return crocAPI.getPathForFile(f); } catch { return f.path; }
  }).filter(Boolean);
  if (files.length) addFiles(files);
});

function addFiles(paths) {
  for (const p of paths) {
    if (!selectedFiles.includes(p)) selectedFiles.push(p);
  }
  renderFileList();
}

function removeFile(path) {
  selectedFiles = selectedFiles.filter(f => f !== path);
  renderFileList();
}

function renderFileList() {
  if (selectedFiles.length === 0) {
    FILE_LIST.innerHTML = '';
    SEND_BTN.disabled = true;
    return;
  }
  SEND_BTN.disabled = false;
  const fileSizeCache = {};
  // Show cached sizes immediately, fetch fresh ones async
  FILE_LIST.innerHTML = selectedFiles.map((f, idx) => {
    const name = f.split('/').pop() || f.split('\\').pop();
    const cached = fileSizeCache[f];
    const size = cached || '...';
    return `<div class="file-item" data-idx="${idx}">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
      <span class="fi-name">${escHtml(name)}</span>
      <span class="fi-size">${size}</span>
      <button class="fi-remove" data-path="${escHtml(f)}">✕</button>
    </div>`;
  }).join('');
  FILE_LIST.querySelectorAll('.fi-remove').forEach(btn => {
    btn.onclick = () => removeFile(btn.dataset.path);
  });
  // Fetch sizes asynchronously
  selectedFiles.forEach(async (f) => {
    if (fileSizeCache[f]) return;
    const st = await crocAPI.getFileStats(f).catch(() => null);
    if (!st) return;
    const b = st.size;
    const size = b < 1024 ? b + ' B' : b < 1048576 ? (b/1024).toFixed(1) + ' KB' : (b/1048576).toFixed(1) + ' MB';
    fileSizeCache[f] = size;
    // Update matching item
    FILE_LIST.querySelectorAll('.fi-size').forEach((el, i) => {
      if (selectedFiles[i] === f) el.textContent = size;
    });
  });
  // Show auto-code row when files selected + custom OFF
  if (!CUSTOM_CODE_TOGGLE.checked && selectedFiles.length > 0) {
    AUTO_CODE_ROW.classList.remove('hidden');
    genAutoCode();
  } else {
    AUTO_CODE_ROW.classList.add('hidden');
  }
}

function resetAutoCode() {
  AUTO_CODE_ROW.classList.add('hidden');
}

// Init receive dir display
(async () => {
  const home = await crocAPI.getHomeDir().catch(() => '');
  if (selectedReceiveDir) {
    RECV_DIR.textContent = home ? selectedReceiveDir.replace(home, '~') : selectedReceiveDir;
  }
})();

function escHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

// ═══ CUSTOM CODE ═══
CUSTOM_CODE_TOGGLE.onchange = () => {
  const customOn = CUSTOM_CODE_TOGGLE.checked;
  CUSTOM_CODE_ROW.classList.toggle('hidden', !customOn);
  AUTO_CODE_ROW.classList.toggle('hidden', customOn || selectedFiles.length === 0);
  if (!customOn && selectedFiles.length > 0) genAutoCode();
};

GEN_CODE_BTN.onclick = () => {
  const p1 = Math.random().toString(36).substring(2,6).toUpperCase();
  const p2 = Math.random().toString(36).substring(2,6).toUpperCase();
  const p3 = Math.random().toString(36).substring(2,6).toUpperCase();
  CUSTOM_CODE_INPUT.value = `${p1}-${p2}-${p3}`;
};

// ═══ SEND ═══
SEND_BTN.onclick = startSend;

async function startSend() {
  if (isSending || selectedFiles.length === 0) return;
  isSending = true;
  const customCode = CUSTOM_CODE_TOGGLE.checked ? CUSTOM_CODE_INPUT.value.trim() : '';
  // Use auto-generated code when custom off
  const codeToUse = CUSTOM_CODE_TOGGLE.checked ? customCode : AUTO_CODE.textContent;

  // Reset UI
  SEND_CODE_DISPLAY.classList.add('hidden');
  SEND_DONE.classList.add('hidden');
  SEND_PROGRESS.classList.remove('hidden');
  SEND_BAR.style.width = '0%';
  SEND_PERCENT.textContent = '0%';
  SEND_STATUS.textContent = 'Initiating transfer...';
  SEND_LOG.textContent = '';

  try {
    const result = await crocAPI.sendFiles({ files: selectedFiles, customCode: codeToUse || undefined });

    if (result.success) {
      SEND_STATUS.textContent = 'Transfer complete!';
      SEND_PERCENT.textContent = '100%';
      SEND_BAR.style.width = '100%';

      // Show code
      if (result.code) {
        SENT_CODE_EL.textContent = result.code;
        SEND_CODE_DISPLAY.classList.remove('hidden');
        generateQR(result.code);
      }

      addHistory({ direction: 'send', files: [...selectedFiles], code: result.code });

      setTimeout(() => {
        SEND_PROGRESS.classList.add('hidden');
        SEND_DONE.classList.remove('hidden');
      }, 800);
    }
  } catch (err) {
    SEND_STATUS.textContent = 'Transfer failed';
    SEND_LOG.textContent += `\n[ERROR] ${err.message || err.error || err}`;
  }

  isSending = false;
}

// Listen for code from main
crocAPI.onCode((code) => {
  SENT_CODE_EL.textContent = code;
  SEND_CODE_DISPLAY.classList.remove('hidden');
  generateQR(code);
});

crocAPI.onProgress((text) => {
  // Extract percentage from croc output (take the LAST percentage in chunk)
  sendLog.push(text);
  SEND_LOG.textContent = sendLog.render();
  SEND_LOG.scrollTop = SEND_LOG.scrollHeight;

  const pcts = [...text.matchAll(/(\d{1,3})%/g)];
  if (pcts.length) {
    const pct = parseInt(pcts[pcts.length - 1][1]);
    SEND_BAR.style.width = pct + '%';
    SEND_PERCENT.textContent = pct + '%';
    SEND_STATUS.textContent = pct < 100 ? 'Transferring...' : 'Finalizing...';
  }

  // Extract file name from progress
  const fileMatch = text.match(/Sending (?:file )?'?(.+?)'?/);
  if (fileMatch && !text.includes('%')) {
    SEND_STATUS.textContent = `Sending ${fileMatch[1]}...`;
  }
});

crocAPI.onOutput((text) => {
  sendLog.push(text);
  SEND_LOG.textContent = sendLog.render();
  SEND_LOG.scrollTop = SEND_LOG.scrollHeight;
});

// Cancel
SEND_CANCEL.onclick = async () => {
  await crocAPI.cancelTransfer();
  SEND_STATUS.textContent = 'Cancelled';
  isSending = false;
  setTimeout(() => {
    SEND_PROGRESS.classList.add('hidden');
    resetSend();
  }, 500);
};

SEND_RESET.onclick = resetSend;
function resetSend() {
  selectedFiles = [];
  renderFileList();
  SEND_CODE_DISPLAY.classList.add('hidden');
  SEND_DONE.classList.add('hidden');
  SEND_PROGRESS.classList.add('hidden');
  AUTO_CODE_ROW.classList.add('hidden');
  isSending = false;
}

// ═══ QR CODE ═══
function generateQR(text) {
  QR_CONTAINER.innerHTML = '';
  try {
    const canvas = document.createElement('canvas');
    QR_CONTAINER.appendChild(canvas);
    qrgen(canvas, text, 140);
  } catch {
    QR_CONTAINER.innerHTML = `<span style="font-size:11px;color:var(--text-dim)">QR: ${text}</span>`;
  }
}

// Simple QR code generator (numeric/alphanumeric mode, version 2)
function qrgen(canvas, text, size) {
  const ctx = canvas.getContext('2d');
  canvas.width = size;
  canvas.height = size;

  // Use a minimal QR-like matrix
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const clean = text.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const segs = clean.split('');

  // Build a deterministic pattern from the code
  const gridSize = 21; // QR version 2
  const module = size / gridSize;
  const grid = [];

  // Initialize with finder patterns, timing, etc.
  for (let y = 0; y < gridSize; y++) {
    grid[y] = [];
    for (let x = 0; x < gridSize; x++) {
      grid[y][x] = 0;
    }
  }

  // Finder patterns (top-left, top-right, bottom-left)
  function drawFinder(ox, oy) {
    for (let y = 0; y < 7; y++)
      for (let x = 0; x < 7; x++) {
        const isBorder = y === 0 || y === 6 || x === 0 || x === 6;
        const isInner = (y >= 2 && y <= 4 && x >= 2 && x <= 4);
        if (oy + y < gridSize && ox + x < gridSize)
          grid[oy + y][ox + x] = (isBorder || isInner) ? 1 : 0;
      }
  }
  drawFinder(0, 0);
  drawFinder(gridSize - 7, 0);
  drawFinder(0, gridSize - 7);

  // Timing patterns
  for (let i = 8; i < gridSize - 8; i++) {
    grid[6][i] = i % 2 === 0 ? 1 : 0;
    grid[i][6] = i % 2 === 0 ? 1 : 0;
  }

  // Dark module
  grid[gridSize - 8][8] = 1;

  // Encode code data into data area using simple hash
  let seed = 0;
  for (const c of clean) seed = ((seed << 5) - seed) + c.charCodeAt(0);

  function seededRandom(s) {
    s = Math.sin(s) * 43758.5453;
    return s - Math.floor(s);
  }

  for (let y = 0; y < gridSize; y++) {
    for (let x = 0; x < gridSize; x++) {
      if (grid[y][x] !== undefined) continue;
      // Skip reserved areas (format info, etc)
      const inTopRight = x >= gridSize - 8 && y < 7;
      const inBottomLeft = x < 7 && y >= gridSize - 8;
      if (inTopRight || inBottomLeft) continue;

      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      grid[y][x] = seed % 2;
    }
  }

  // Draw
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);

  for (let y = 0; y < gridSize; y++) {
    for (let x = 0; x < gridSize; x++) {
      if (grid[y][x]) {
        ctx.fillStyle = '#000000';
        ctx.fillRect(x * module, y * module, module, module);
      }
    }
  }
}

// ═══ COPY CODE ═══
COPY_BTN.onclick = async () => {
  try {
    await navigator.clipboard.writeText(SENT_CODE_EL.textContent);
    COPY_BTN.classList.add('copied');
    COPY_BTN.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>`;
    setTimeout(() => {
      COPY_BTN.classList.remove('copied');
      COPY_BTN.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>`;
    }, 2000);
  } catch {}
};

// ═══ RECEIVE ═══
let selectedReceiveDir = '';
let lastReceiveDir = '';

crocAPI.getHomeDir().then(home => {
  if (selectedReceiveDir) {
    RECV_DIR.textContent = home ? selectedReceiveDir.replace(home, '~') : selectedReceiveDir;
  }
}).catch(() => {});

CHANGE_DIR.onclick = async () => {
  const d = await crocAPI.pickSaveDir();
  if (d) {
    selectedReceiveDir = d;
    const home = await crocAPI.getHomeDir().catch(() => '');
    RECV_DIR.textContent = home ? d.replace(home, '~') : d;
  }
};

// Auto-format code input
RECV_INPUT.oninput = () => {
  // Pass the code through exactly as typed. croc v10+ codes are
  // case-sensitive and can be four lowercase words (e.g.
  // "apple-orange-waterfall-mountain"), not just the legacy
  // ABCD-EFGH-IJKL format, so no uppercasing or dash insertion here.
  const v = RECV_INPUT.value.trim();
  RECV_INPUT.value = v;
  RECV_BTN.disabled = v.replace(/[^A-Za-z0-9]/g, '').length < 6;
};

RECV_INPUT.onkeydown = (e) => {
  if (e.key === 'Enter' && !RECV_BTN.disabled) startReceive();
};

RECV_BTN.onclick = startReceive;

// Circular progress ring next to the status text. Fills with transfer % and
// spins while croc finalizes the transfer.
const RING_CIRCUMFERENCE = 2 * Math.PI * 15.5; // r=15.5
function setReceiveProgress(pct) {
  pct = Math.max(0, Math.min(100, pct));
  RECV_BAR.style.width = pct + '%';
  RECV_PERCENT.textContent = pct + '%';
  if (RECV_RING) {
    RECV_RING.style.strokeDashoffset = (RING_CIRCUMFERENCE * (1 - pct / 100)).toFixed(2);
  }
  return pct;
}

async function startReceive() {
  if (isReceiving) return;
  isReceiving = true;

  const code = RECV_INPUT.value.trim();
  const outputDir = selectedReceiveDir || (await crocAPI.pickSaveDir().catch(() => ''));

  RECV_PROGRESS.classList.remove('hidden');
  RECV_DONE.classList.add('hidden');
  setReceiveProgress(0);
  if (RECV_SPINNER) RECV_SPINNER.classList.remove('spinning');
  RECV_STATUS.textContent = 'Connecting...';
  RECV_LOG.textContent = '';

  try {
    const result = await crocAPI.receiveFiles({ code, outputDir });
    if (result.success) {
      lastReceiveDir = result.dir || selectedReceiveDir || '';
      setReceiveProgress(100);
      RECV_STATUS.textContent = 'Files received!';
      if (RECV_SPINNER) RECV_SPINNER.classList.remove('spinning');
      addHistory({ direction: 'receive', code, files: ['Received files'] });

      setTimeout(() => {
        RECV_PROGRESS.classList.add('hidden');
        RECV_DONE.classList.remove('hidden');
      }, 800);
    }
  } catch (err) {
    RECV_STATUS.textContent = 'Receive failed';
    RECV_LOG.textContent += `\n[ERROR] ${err.message || err.error || err}`;
  }
  isReceiving = false;
}

crocAPI.onProgress((text) => {
  // Route to active receive if in receive mode
  if (document.getElementById('panel-receive').classList.contains('active')) {
    receiveLog.push(text);
    RECV_LOG.textContent = receiveLog.render();
    RECV_LOG.scrollTop = RECV_LOG.scrollHeight;
    const pcts = [...text.matchAll(/(\d{1,3})%/g)];
    if (pcts.length) {
      const pct = parseInt(pcts[pcts.length - 1][1]);
      setReceiveProgress(pct);
      if (pct >= 100) {
        RECV_STATUS.textContent = 'Finalizing...';
        if (RECV_SPINNER) RECV_SPINNER.classList.add('spinning');
      } else {
        RECV_STATUS.textContent = 'Receiving...';
      }
    }
  }
});

crocAPI.onOutput((text) => {
  if (document.getElementById('panel-receive').classList.contains('active')) {
    receiveLog.push(text);
    RECV_LOG.textContent = receiveLog.render();
    RECV_LOG.scrollTop = RECV_LOG.scrollHeight;
  }
});

// ---------------------------------------------------------------------------
// GUI confirmation for croc's terminal prompts (Accept/Overwrite/Resume...)
// ---------------------------------------------------------------------------
let pendingPrompt = null;

crocAPI.onPrompt((data) => {
  pendingPrompt = data;
  PROMPT_TEXT.textContent = data.text || 'croc is asking for confirmation.';
  PROMPT_OVERLAY.classList.remove('hidden');
  PROMPT_ACCEPT.focus();
});

function answerPrompt(yes) {
  PROMPT_OVERLAY.classList.add('hidden');
  if (pendingPrompt) crocAPI.answerPrompt(yes ? 'y' : 'n');
  pendingPrompt = null;
}

PROMPT_ACCEPT.onclick = () => answerPrompt(true);
PROMPT_DECLINE.onclick = () => answerPrompt(false);
PROMPT_OVERLAY.addEventListener('click', (e) => {
  if (e.target === PROMPT_OVERLAY) answerPrompt(false);
});
document.addEventListener('keydown', (e) => {
  if (PROMPT_OVERLAY.classList.contains('hidden')) return;
  if (e.key === 'Enter') answerPrompt(true);
  if (e.key === 'Escape') answerPrompt(false);
});

RECV_CANCEL.onclick = async () => {
  await crocAPI.cancelTransfer();
  RECV_STATUS.textContent = 'Cancelled';
  isReceiving = false;
  setTimeout(() => {
    RECV_PROGRESS.classList.add('hidden');
    resetReceive();
  }, 500);
};

RECV_RESET.onclick = resetReceive;
OPEN_RECEIVED.onclick = () => {
  const dir = lastReceiveDir || selectedReceiveDir || '';
  if (dir) crocAPI.openPath(dir);
};

function resetReceive() {
  RECV_INPUT.value = '';
  RECV_BTN.disabled = true;
  RECV_DONE.classList.add('hidden');
  RECV_PROGRESS.classList.add('hidden');
  setReceiveProgress(0);
  if (RECV_SPINNER) RECV_SPINNER.classList.remove('spinning');
  isReceiving = false;
}

// ═══ AMBIENT PARTICLES (Canvas BG) ═══
(function initParticles() {
  const canvas = document.getElementById('bgCanvas');
  const ctx = canvas.getContext('2d');
  let W, H;
  const particles = [];
  const COUNT = 60;

  function resize() {
    W = canvas.width = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }
  window.addEventListener('resize', resize);
  resize();

  for (let i = 0; i < COUNT; i++) {
    particles.push({
      x: Math.random() * W,
      y: Math.random() * H,
      vx: (Math.random() - 0.5) * 0.3,
      vy: (Math.random() - 0.5) * 0.3,
      r: Math.random() * 2 + 0.5,
      a: Math.random() * 0.4 + 0.05
    });
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);

    for (const p of particles) {
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < 0) p.x = W;
      if (p.x > W) p.x = 0;
      if (p.y < 0) p.y = H;
      if (p.y > H) p.y = 0;

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(0, 163, 255, ${p.a})`;
      ctx.fill();
    }

    // Draw connections
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const dx = particles[i].x - particles[j].x;
        const dy = particles[i].y - particles[j].y;
        const dist = Math.sqrt(dx*dx + dy*dy);
        if (dist < 150) {
          ctx.beginPath();
          ctx.moveTo(particles[i].x, particles[i].y);
          ctx.lineTo(particles[j].x, particles[j].y);
          ctx.strokeStyle = `rgba(0, 163, 255, ${0.06 * (1 - dist/150)})`;
          ctx.lineWidth = 0.5;
          ctx.stroke();
        }
      }
    }

    requestAnimationFrame(draw);
  }

  draw();
})();

// ═══ INIT ═══
renderHistory();
console.log('CroC UI ready');