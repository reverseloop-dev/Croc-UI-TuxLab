const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const os = require('os');

let mainWindow;
let activeProcess = null;
let promptPending = false;

// Smooth opacity fade-in for the main window (setOpacity works on Windows and
// macOS; on Linux it needs a compositor, otherwise it is a no-op).
function animateOpacity(win, from, to, duration, cb) {
  if (!win || win.isDestroyed()) { cb && cb(); return; }
  const steps = 24;
  const stepMs = duration / steps;
  let i = 0;
  const timer = setInterval(() => {
    i++;
    const v = from + (to - from) * (i / steps);
    try { win.setOpacity(v); } catch {}
    if (i >= steps) {
      clearInterval(timer);
      cb && cb();
    }
  }, stepMs);
}

// croc asks "(Y/n)" / "(y/N)" style questions on stderr (accept, overwrite,
// resume, sender confirmation). Detect them and surface them in the GUI;
// the answer is written back to croc's stdin via 'croc:answer'.
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
    text: ctx || 'croc is asking for confirmation.',
    defaultYes: /\(Y\/n\)/.test(clean)
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 780,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    transparent: false,
    backgroundColor: '#0a0a12',
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

// ---------------------------------------------------------------------------
// croc binary resolution
// ---------------------------------------------------------------------------
let crocNeedsShell = false;

function getCrocPath() {
  // 1. explicit override
  if (process.env.CROC_BIN) return process.env.CROC_BIN;

  // 2. croc.exe next to the app. Portable builds expose the folder where the
  // original exe lives via PORTABLE_EXECUTABLE_DIR (e.g. crocui.exe placed in
  // the same folder as croc.exe on Windows).
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

  // 3. PATH lookup ('which' does not exist on Windows, use 'where')
  try {
    const cmd = process.platform === 'win32' ? 'where croc' : 'which croc';
    const out = execSync(cmd, { encoding: 'utf8' }).trim();
    const first = out.split(/\r?\n/)[0].trim();
    if (first) {
      // npm/global installs often expose croc as a .cmd shim, which spawn()
      // cannot execute directly without a shell
      crocNeedsShell = /\.(cmd|bat)$/i.test(first);
      return first;
    }
  } catch {}

  return 'croc';
}

const crocBin = getCrocPath();

// croc v10+ reworked the CLI: custom code phrases now go through the
// CROC_SECRET environment variable ("new mode") on every platform.
// `croc send --code X` / `croc --yes <code>` only work on older versions.
// Detection is lazy (first transfer) so app startup is not blocked.
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

// spawn helper: .cmd/.bat shims (Windows npm/scoop installs) need a shell
function spawnCroc(args, opts = {}) {
  const spawnOpts = { stdio: ['pipe', 'pipe', 'pipe'], ...opts };
  if (crocNeedsShell && process.platform === 'win32') spawnOpts.shell = true;
  return spawn(crocBin, args, spawnOpts);
}

// Make sure the receive folder exists before spawning croc. On Windows a
// missing cwd (e.g. localized/redirected Downloads) makes spawn fail with
// ENOENT, which previously surfaced as a useless '[object Object]' error.
function ensureDir(dir) {
  for (const c of [dir, path.join(os.homedir(), 'Downloads'), os.homedir()]) {
    if (!c) continue;
    try {
      fs.mkdirSync(c, { recursive: true });
      return c;
    } catch {}
  }
  return os.homedir();
}

// Reject with a real Error so Electron keeps the message. Rejecting with a
// plain object gets serialized as '[object Object]' on the renderer side.
function transferError(message, output) {
  const out = (output || '').trim();
  const tail = out.split(/\r?\n/).slice(-6).join('\n');
  const err = new Error(tail ? `${message}\n\n${tail}` : message);
  err.output = out;
  err.success = false;
  return err;
}

// ---------------------------------------------------------------------------
// Window controls
// ---------------------------------------------------------------------------
ipcMain.on('win:minimize', () => mainWindow?.minimize());
ipcMain.on('win:maximize', () => {
  mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
});
ipcMain.on('win:close', () => mainWindow?.close());
ipcMain.handle('win:isMaximized', () => mainWindow?.isMaximized());

// ---------------------------------------------------------------------------
// System / dialogs
// ---------------------------------------------------------------------------
ipcMain.handle('croc:version', async () => {
  try {
    return execSync(`"${crocBin}" --version 2>&1`, { encoding: 'utf8' }).trim();
  } catch { return 'croc not found'; }
});

// Separate dialogs: on Windows, combining openFile+openDirectory in one
// dialog can make single files unselectable. Files and folders get their own.
ipcMain.handle('dialog:pickFiles', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections']
  });
  return result.canceled ? [] : result.filePaths;
});

ipcMain.handle('dialog:pickFolders', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'multiSelections']
  });
  return result.canceled ? [] : result.filePaths;
});

ipcMain.handle('dialog:pickSaveDir', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    defaultPath: path.join(os.homedir(), 'Downloads')
  });
  return result.canceled ? null : result.filePaths[0];
});

// ---------------------------------------------------------------------------
// Send
// ---------------------------------------------------------------------------
ipcMain.handle('croc:send', async (event, { files, customCode }) => {
  return new Promise((resolve, reject) => {
    if (activeProcess) {
      activeProcess.kill();
      activeProcess = null;
    }

    let args;
    const env = { ...process.env };
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

      // Extract code from "Code is: XXXX-XXXX-XXXX" (or legacy 4-4-4 pattern)
      const codeMatch = text.match(/Code is: (\S+)/) || text.match(/[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}/);
      if (codeMatch && !code) {
        code = codeMatch[1] || codeMatch[0];
        mainWindow?.webContents.send('croc:code', code);
      }
    });

    activeProcess.stderr.on('data', (data) => {
      const text = data.toString();
      mainWindow?.webContents.send('croc:progress', text);
      checkForPrompt(text, outputBuffer);
    });

    activeProcess.on('close', (codeExit) => {
      activeProcess = null;
      promptPending = false;
      if (codeExit === 0) {
        // If code wasn't extracted from stdout, try the full buffer
        if (!code) {
          const match = outputBuffer.match(/Code is: (\S+)/) || outputBuffer.match(/[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}/);
          if (match) code = match[1] || match[0];
        }
        resolve({ success: true, code, output: outputBuffer });
      } else {
        reject(transferError(`Process exited with code ${codeExit}`, outputBuffer));
      }
    });

    activeProcess.on('error', (err) => {
      activeProcess = null;
      reject(transferError(`Failed to launch croc (${crocBin}): ${err.message}`, outputBuffer));
    });
  });
});

// ---------------------------------------------------------------------------
// Receive
// ---------------------------------------------------------------------------
ipcMain.handle('croc:receive', async (event, { code, outputDir }) => {
  return new Promise((resolve, reject) => {
    if (activeProcess) {
      activeProcess.kill();
      activeProcess = null;
    }

    const outDir = ensureDir(outputDir);
    let args;
    let opts = {};
    detectCrocVersion();
    if (newCrocCli) {
      args = ['--yes', '--ignore-stdin', '--out', outDir];
      opts = { cwd: os.homedir(), env: { ...process.env, CROC_SECRET: code } };
    } else {
      args = ['--ignore-stdin', '--yes', code];
      opts = { cwd: outDir };
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
      if (codeExit === 0) {
        resolve({ success: true, output: outputBuffer, dir: outDir });
      } else {
        reject(transferError(`Process exited with code ${codeExit}`, outputBuffer));
      }
    });

    activeProcess.on('error', (err) => {
      activeProcess = null;
      reject(transferError(`Failed to launch croc (${crocBin}): ${err.message}`, outputBuffer));
    });
  });
});

// ---------------------------------------------------------------------------
// Cancel / misc
// ---------------------------------------------------------------------------
ipcMain.handle('croc:cancel', async () => {
  if (activeProcess) {
    activeProcess.kill();
    activeProcess = null;
    promptPending = false;
    return true;
  }
  return false;
});

// Write the GUI answer ("y"/"n") to the running croc process stdin
ipcMain.handle('croc:answer', async (_, answer) => {
  if (activeProcess && activeProcess.stdin && !activeProcess.stdin.destroyed) {
    activeProcess.stdin.write((answer === 'y' ? 'y' : 'n') + '\n');
    promptPending = false;
    return true;
  }
  return false;
});

ipcMain.handle('shell:openPath', async (_, p) => {
  shell.openPath(path.resolve(p));
});

ipcMain.handle('fs:stat', async (_, filepath) => {
  try {
    const st = fs.statSync(filepath);
    return { size: st.size, isDirectory: st.isDirectory() };
  } catch { return null; }
});

ipcMain.handle('os:homedir', () => os.homedir());

app.whenReady().then(() => {
  createWindow();

  // Fade the main window in once it is ready to paint
  mainWindow.once('ready-to-show', () => {
    try { mainWindow.setOpacity(0); } catch {}
    mainWindow.show();
    animateOpacity(mainWindow, 0, 1, 400);
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
