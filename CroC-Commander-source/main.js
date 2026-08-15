// Croc Commander — gestore file a doppio pannello + trasferimenti croc
const { app, BrowserWindow, ipcMain, dialog, shell, clipboard } = require('electron');
const path = require('path');
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const os = require('os');

let mainWindow;
let activeProcess = null;   // processo croc o shell in esecuzione
let promptPending = false;
let runId = 0;

/* ------------------------------------------------------------------ */
/* Finestra                                                            */
/* ------------------------------------------------------------------ */
function animateOpacity(win, from, to, duration, cb) {
  if (!win || win.isDestroyed()) { cb && cb(); return; }
  const steps = 24, stepMs = duration / steps;
  let i = 0;
  const timer = setInterval(() => {
    i++;
    const v = from + (to - from) * (i / steps);
    try { win.setOpacity(v); } catch {}
    if (i >= steps) { clearInterval(timer); cb && cb(); }
  }, stepMs);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#0000AA',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false
    }
  });
  mainWindow.loadFile('index.html');
}

ipcMain.on('win:minimize', () => mainWindow?.minimize());
ipcMain.on('win:maximize', () => {
  mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
});
ipcMain.on('win:close', () => mainWindow?.close());
ipcMain.handle('win:isMaximized', () => mainWindow?.isMaximized());

/* ------------------------------------------------------------------ */
/* Rilevamento binario croc                                            */
/* ------------------------------------------------------------------ */
let crocNeedsShell = false;
function getCrocPath() {
  if (process.env.CROC_BIN) return process.env.CROC_BIN;
  const exeDirs = [];
  if (process.env.PORTABLE_EXECUTABLE_DIR) exeDirs.push(process.env.PORTABLE_EXECUTABLE_DIR);
  exeDirs.push(__dirname);
  try { exeDirs.push(path.dirname(process.execPath)); } catch {}
  const exeNames = process.platform === 'win32' ? ['croc.exe', 'croc.bat', 'croc.cmd'] : ['croc'];
  for (const dir of exeDirs) {
    for (const name of exeNames) {
      const candidate = path.join(dir, name);
      try {
        if (fs.existsSync(candidate)) {
          crocNeedsShell = /\.(cmd|bat)$/i.test(candidate);
          return candidate;
        }
      } catch {}
    }
  }
  try {
    const cmd = process.platform === 'win32' ? 'where croc' : 'which croc';
    const out = execSync(cmd, { encoding: 'utf8' }).trim();
    const first = out.split(/\r?\n/)[0].trim();
    if (first) {
      crocNeedsShell = /\.(cmd|bat)$/i.test(first);
      return first;
    }
  } catch {}
  return 'croc';
}
const crocBin = getCrocPath();

let crocMajor = 0;
let newCrocCli = false;
function detectCrocVersion() {
  if (crocMajor) return;
  try {
    const v = execSync(`"${crocBin}" --version 2>&1`, { encoding: 'utf8' });
    const m = v.match(/(\d+)\./);
    if (m) crocMajor = parseInt(m[1], 10);
  } catch {}
  newCrocCli = crocMajor >= 10;
}

function spawnCroc(args, opts = {}) {
  const spawnOpts = { stdio: ['pipe', 'pipe', 'pipe'], ...opts };
  if (crocNeedsShell && process.platform === 'win32') spawnOpts.shell = true;
  return spawn(crocBin, args, spawnOpts);
}

function ensureDir(dir) {
  for (const c of [dir, path.join(os.homedir(), 'Downloads'), os.homedir()]) {
    if (!c) continue;
    try { fs.mkdirSync(c, { recursive: true }); return c; } catch {}
  }
  return os.homedir();
}

function transferError(message, output) {
  const out = (output || '').trim();
  const tail = out.split(/\r?\n/).slice(-6).join('\n');
  const err = new Error(tail ? `${message}\n\n${tail}` : message);
  err.output = out;
  err.success = false;
  return err;
}

function checkForPrompt(chunk, buffer) {
  if (promptPending) return;
  const clean = chunk.replace(/\x1b\[[0-9;]*m/g, '');
  if (!/\([Yy]\/[Nn]\)/.test(clean)) return;
  const ctx = (clean + '\n' + buffer)
    .replace(/\x1b\[[0-9;]*m/g, '')
    .replace(/\r/g, '\n')
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean)
    .slice(-5)
    .join('\n');
  promptPending = true;
  mainWindow?.webContents.send('croc:prompt', {
    text: ctx || 'croc chiede una conferma.',
    defaultYes: /\(Y\/n\)/.test(clean)
  });
}

/* ------------------------------------------------------------------ */
/* IPC croc                                                            */
/* ------------------------------------------------------------------ */
ipcMain.handle('croc:version', async () => {
  try { return execSync(`"${crocBin}" --version 2>&1`, { encoding: 'utf8' }).trim(); }
  catch { return 'croc non trovato'; }
});

ipcMain.handle('dialog:pickSaveDir', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    defaultPath: path.join(os.homedir(), 'Downloads')
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('croc:send', async (event, { files, customCode, relay, relayPass }) => {
  return new Promise((resolve, reject) => {
    if (activeProcess) { activeProcess.kill(); activeProcess = null; }
    let args;
    const env = { ...process.env };
    if (relay) env.CROC_RELAY = relay;
    if (relayPass) env.CROC_PASS = relayPass;
    detectCrocVersion();
    if (newCrocCli) {
      args = ['--yes', '--ignore-stdin', 'send'];
      if (customCode) env.CROC_SECRET = customCode;
      args.push(...files);
    } else {
      args = ['--ignore-stdin', 'send'];
      if (customCode) args.push('--code', customCode);
      args.push(...files);
    }
    activeProcess = spawnCroc(args, { env });
    let code = '';
    let outputBuffer = '';
    activeProcess.stdout.on('data', (data) => {
      const text = data.toString();
      outputBuffer += text;
      mainWindow?.webContents.send('croc:output', text);
      const codeMatch = text.match(/Code is: (\S+)/);
      if (codeMatch && !code) {
        code = codeMatch[1];
        mainWindow?.webContents.send('croc:code', code);
      }
    });
    activeProcess.stderr.on('data', (data) => {
      const text = data.toString();
      mainWindow?.webContents.send('croc:progress', text);
      outputBuffer += text;
      const codeMatch = text.match(/Code is: (\S+)/);
      if (codeMatch && !code) {
        code = codeMatch[1];
        mainWindow?.webContents.send('croc:code', code);
      }
      checkForPrompt(text, outputBuffer);
    });
    activeProcess.on('close', (codeExit) => {
      activeProcess = null;
      promptPending = false;
      if (codeExit === 0) {
        if (!code) {
          const match = outputBuffer.match(/Code is: (\S+)/);
          if (match) code = match[1];
        }
        resolve({ success: true, code, output: outputBuffer });
      } else {
        reject(transferError(`Processo terminato con codice ${codeExit}`, outputBuffer));
      }
    });
    activeProcess.on('error', (err) => {
      activeProcess = null;
      reject(transferError(`Impossibile avviare croc (${crocBin}): ${err.message}`, outputBuffer));
    });
  });
});

ipcMain.handle('croc:receive', async (event, { code, outputDir, relay, relayPass }) => {
  return new Promise((resolve, reject) => {
    if (activeProcess) { activeProcess.kill(); activeProcess = null; }
    const outDir = ensureDir(outputDir);
    let args, opts = {};
    const env = { ...process.env };
    if (relay) env.CROC_RELAY = relay;
    if (relayPass) env.CROC_PASS = relayPass;
    detectCrocVersion();
    if (newCrocCli) {
      args = ['--yes', '--ignore-stdin', '--out', outDir];
      env.CROC_SECRET = code;
      opts = { cwd: os.homedir(), env };
    } else {
      args = ['--ignore-stdin', '--yes', code];
      if (relay) args.push('--relay', relay);
      opts = { cwd: outDir, env };
    }
    activeProcess = spawnCroc(args, opts);
    let outputBuffer = '';
    activeProcess.stdout.on('data', (data) => {
      const text = data.toString();
      outputBuffer += text;
      mainWindow?.webContents.send('croc:output', text);
    });
    activeProcess.stderr.on('data', (data) => {
      const text = data.toString();
      mainWindow?.webContents.send('croc:progress', text);
      outputBuffer += text;
      checkForPrompt(text, outputBuffer);
    });
    activeProcess.on('close', (codeExit) => {
      activeProcess = null;
      promptPending = false;
      if (codeExit === 0) resolve({ success: true, output: outputBuffer, dir: outDir });
      else reject(transferError(`Processo terminato con codice ${codeExit}`, outputBuffer));
    });
    activeProcess.on('error', (err) => {
      activeProcess = null;
      reject(transferError(`Impossibile avviare croc (${crocBin}): ${err.message}`, outputBuffer));
    });
  });
});

ipcMain.handle('croc:cancel', async () => {
  if (activeProcess) {
    activeProcess.kill();
    activeProcess = null;
    promptPending = false;
    return true;
  }
  return false;
});

ipcMain.handle('croc:answer', async (_, answer) => {
  if (activeProcess && activeProcess.stdin && !activeProcess.stdin.destroyed) {
    activeProcess.stdin.write((answer === 'y' ? 'y' : 'n') + '\n');
    promptPending = false;
    return true;
  }
  return false;
});

/* ------------------------------------------------------------------ */
/* Filesystem                                                          */
/* ------------------------------------------------------------------ */
function modeString(st) {
  const m = st.mode;
  let s = st.isDirectory() ? 'd' : (st.isSymbolicLink() ? 'l' : '-');
  const bits = [0o400, 0o200, 0o100, 0o040, 0o020, 0o010, 0o004, 0o002, 0o001];
  const chars = ['r', 'w', 'x', 'r', 'w', 'x', 'r', 'w', 'x'];
  bits.forEach((b, i) => s += (m & b) ? chars[i] : '-');
  return s;
}

ipcMain.handle('fs:list', async (_, dir) => {
  try {
    const entries = [];
    const items = fs.readdirSync(dir, { withFileTypes: true });
    for (const it of items) {
      try {
        const full = path.join(dir, it.name);
        const st = fs.statSync(full);
        entries.push({
          name: it.name,
          size: st.isDirectory() ? -1 : st.size,
          isDir: st.isDirectory(),
          mtime: st.mtimeMs,
          mode: modeString(st),
          hidden: it.name.startsWith('.')
        });
      } catch {
        entries.push({ name: it.name, size: -1, isDir: it.isDirectory(), mtime: 0, mode: '---------', hidden: it.name.startsWith('.') });
      }
    }
    return { ok: true, dir, entries };
  } catch (err) {
    return { ok: false, dir, error: err.message };
  }
});

ipcMain.handle('fs:stat', async (_, p) => {
  try {
    const st = fs.statSync(p);
    return { exists: true, size: st.size, isDirectory: st.isDirectory(), mtime: st.mtimeMs, mode: modeString(st) };
  } catch { return { exists: false }; }
});

ipcMain.handle('fs:read', async (_, p) => {
  try {
    const st = fs.statSync(p);
    if (st.isDirectory()) return { ok: false, error: 'È una cartella' };
    if (st.size > 8 * 1024 * 1024) return { ok: false, error: 'File troppo grande per la visualizzazione (oltre 8 MB) — usa F3 per la vista esadecimale' };
    const buf = fs.readFileSync(p);
    return { ok: true, text: buf.toString('utf8'), binary: buf.includes(0), size: st.size };
  } catch (err) { return { ok: false, error: err.message }; }
});

ipcMain.handle('fs:readHex', async (_, p) => {
  try {
    const st = fs.statSync(p);
    if (st.isDirectory()) return { ok: false, error: 'È una cartella' };
    const MAX = 65536;
    const buf = Buffer.alloc(Math.min(MAX, st.size));
    const fd = fs.openSync(p, 'r');
    fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    return { ok: true, hex: buf.toString('hex'), size: st.size, shown: buf.length };
  } catch (err) { return { ok: false, error: err.message }; }
});

ipcMain.handle('fs:readImage', async (_, p) => {
  try {
    const st = fs.statSync(p);
    if (st.isDirectory()) return { ok: false, error: 'È una cartella' };
    const MAX = 16 * 1024 * 1024;
    if (st.size > MAX) return { ok: false, error: 'Immagine troppo grande (max 16 MB)' };
    const buf = fs.readFileSync(p);
    const ext = path.extname(p).toLowerCase().slice(1);
    const mimeMap = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp' };
    const mime = mimeMap[ext] || 'image/png';
    return { ok: true, data: buf.toString('base64'), mime, size: st.size };
  } catch (err) { return { ok: false, error: err.message }; }
});

ipcMain.handle('fs:write', async (_, { p, content }) => {
  try {
    fs.writeFileSync(p, content, 'utf8');
    return { ok: true };
  } catch (err) { return { ok: false, error: err.message }; }
});

ipcMain.handle('fs:drives', async () => {
  const out = new Map();
  try {
    const mounts = fs.readFileSync('/proc/mounts', 'utf8');
    for (const line of mounts.split('\n')) {
      const parts = line.split(' ');
      if (parts.length < 3) continue;
      const [dev, mnt, fstype] = parts;
      if (mnt === '/dev' || mnt.startsWith('/dev/') || mnt.startsWith('/proc') || mnt.startsWith('/sys') || mnt.startsWith('/run/')) continue;
      if (/^(ext[234]|btrfs|xfs|zfs|vfat|ntfs|exfat|fuseblk|nfs|cifs|fuse\.sshfs|overlay)$/.test(fstype)) {
        out.set(mnt, { label: path.basename(mnt) || '/', path: mnt, dev });
      }
    }
  } catch {}
  ['/', '/home', os.homedir(), '/media', '/mnt', '/tmp', '/var', '/opt', '/srv', '/boot'].forEach(p => {
    try { if (fs.existsSync(p)) out.set(p, { label: path.basename(p) || '/', path: p, dev: '' }); } catch {}
  });
  const drives = [...out.values()].sort((a, b) => a.path.length - b.path.length);
  for (const d of drives) {
    try {
      const st = fs.statfsSync(d.path);
      d.free = st.bavail * st.bsize;
      d.total = st.blocks * st.bsize;
    } catch { d.free = 0; d.total = 0; }
  }
  return drives;
});

ipcMain.handle('fs:disk', async (_, p) => {
  try {
    const st = fs.statfsSync(p);
    return { free: st.bavail * st.bsize, total: st.blocks * st.bsize, bfree: st.bfree * st.bsize };
  } catch { return null; }
});

ipcMain.handle('fs:search', async (_, { root, pattern }) => {
  const results = [];
  let scanned = 0;
  const LIMIT = 500;
  const MAXDEPTH = 12;
  const re = new RegExp('^' + pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.') + '$', 'i');
  function walk(dir, depth) {
    if (results.length >= LIMIT || depth > MAXDEPTH) return;
    let items;
    try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const it of items) {
      if (it.name.startsWith('.')) continue;
      scanned++;
      const full = path.join(dir, it.name);
      if (it.isDirectory() && depth < MAXDEPTH) walk(full, depth + 1);
      if (re.test(it.name)) {
        results.push({ path: full, name: it.name, isDir: it.isDirectory() });
        if (results.length >= LIMIT) return;
      }
    }
  }
  try { walk(root, 0); } catch {}
  return { results, scanned, truncated: results.length >= LIMIT };
});

ipcMain.handle('os:info', async () => ({
  platform: os.platform(), release: os.release(), arch: os.arch(),
  hostname: os.hostname(), user: os.userInfo().username,
  cpus: os.cpus().length, cpuModel: os.cpus()[0]?.model || '',
  totalmem: os.totalmem(), freemem: os.freemem(), uptime: os.uptime(),
  home: os.homedir(), tmpdir: os.tmpdir()
}));

ipcMain.handle('os:homedir', () => os.homedir());

/* ------------------------------------------------------------------ */
/* Shell (riga di comando: bash su Linux, cmd su Windows)              */
/* ------------------------------------------------------------------ */
ipcMain.handle('shell:exec', async (event, { cmd, cwd }) => {
  const id = ++runId;
  return new Promise((resolve) => {
    if (activeProcess) { activeProcess.kill(); activeProcess = null; }
    const shellBin = process.platform === 'win32' ? 'cmd.exe' : '/bin/bash';
    const args = process.platform === 'win32' ? ['/c', cmd] : ['-c', cmd];
    const proc = spawn(shellBin, args, {
      cwd: cwd || os.homedir(),
      env: { ...process.env, TERM: 'xterm' },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    activeProcess = proc;
    let output = '';
    const push = (chunk) => {
      output += chunk;
      if (!event.sender.isDestroyed()) event.sender.send('shell:output', { id, chunk });
    };
    proc.stdout.on('data', (d) => push(d.toString()));
    proc.stderr.on('data', (d) => push(d.toString()));
    proc.on('close', (code) => {
      if (activeProcess === proc) activeProcess = null;
      resolve({ id, code: code === null ? -1 : code, output });
    });
    proc.on('error', (err) => {
      if (activeProcess === proc) activeProcess = null;
      resolve({ id, code: -1, output: output + '\n' + err.message });
    });
  });
});

ipcMain.handle('shell:kill', async () => {
  if (activeProcess) { activeProcess.kill(); activeProcess = null; return true; }
  return false;
});

ipcMain.handle('shell:openPath', async (_, p) => {
  shell.openPath(path.resolve(p));
});

ipcMain.handle('clipboard:writeText', async (_, t) => {
  clipboard.writeText(t);
  return true;
});

/* ------------------------------------------------------------------ */
/* Ciclo di vita app                                                   */
/* ------------------------------------------------------------------ */
app.whenReady().then(() => {
  createWindow();
  mainWindow.once('ready-to-show', () => {
    try { mainWindow.setOpacity(0); } catch {}
    mainWindow.show();
    animateOpacity(mainWindow, 0, 1, 250);
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
