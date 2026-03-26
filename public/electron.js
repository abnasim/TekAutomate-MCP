const { app, BrowserWindow, protocol } = require('electron');
const path = require('path');
const fs = require('fs');
const url = require('url');
const net = require('net');
const { spawn } = require('child_process');
const { execSync } = require('child_process');

// Use app.isPackaged instead of electron-is-dev
const isDev = !app.isPackaged;
const MCP_PORT = Number(process.env.MCP_PORT || 8787);

function isPortListening(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host });
    const done = (open) => {
      try {
        socket.destroy();
      } catch {}
      resolve(open);
    };
    socket.setTimeout(400);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

async function startMcpServerSilently() {
  try {
    await killStaleMcpOnPort(MCP_PORT);
    const alreadyRunning = await isPortListening(MCP_PORT);
    if (alreadyRunning) return;
    const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const appRoot = path.join(__dirname, '..');
    const child = spawn(npmCommand, ['--prefix', 'mcp-server', 'run', 'dev'], {
      cwd: appRoot,
      detached: true,
      stdio: 'ignore',
      shell: false,
    });
    child.unref();
  } catch {
    // Silent fail by design.
  }
}

async function killStaleMcpOnPort(port) {
  try {
    const listening = await isPortListening(port);
    if (!listening) return;

    if (process.platform === 'win32') {
      const output = execSync(`netstat -ano -p tcp | findstr :${port}`, {
        stdio: ['ignore', 'pipe', 'ignore'],
      }).toString();
      const pids = Array.from(
        new Set(
          output
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line) => line.split(/\s+/).pop())
            .map((pid) => Number(pid))
            .filter((pid) => Number.isFinite(pid) && pid > 0 && pid !== process.pid)
        )
      );
      pids.forEach((pid) => {
        try {
          execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
        } catch {
          // Silent fail by design.
        }
      });
      return;
    }

    // Best-effort non-Windows support.
    try {
      execSync(`fuser -k ${port}/tcp`, { stdio: 'ignore' });
    } catch {
      // Silent fail by design.
    }
  } catch {
    // Silent fail by design.
  }
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false  // Allow loading local files
    }
  });

  // Load the app
  if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
    mainWindow.webContents.openDevTools();
  } else {
    // In production, load from file system
    const indexPath = path.join(__dirname, '../build/index.html');
    mainWindow.loadFile(indexPath);
    
    // Optional: Open DevTools to debug
    // mainWindow.webContents.openDevTools();
  }
}

app.whenReady().then(async () => {
  await startMcpServerSilently();
  // Intercept file protocol to handle fetch requests
  protocol.interceptFileProtocol('file', (request, callback) => {
    const requestedUrl = request.url.substr(7); // Remove 'file://' prefix
    
    // If it's a request for commands, templates, or other assets
    if (requestedUrl.includes('/commands/') || 
        requestedUrl.includes('/templates/') || 
        requestedUrl.includes('/manual/') ||
        requestedUrl.includes('/mascot/')) {
      
      // Extract the path after build/
      const relativePath = requestedUrl.split('/build/')[1] || requestedUrl;
      const filePath = path.join(__dirname, '../build', relativePath);
      
      callback({ path: filePath });
    } else {
      // Default file handling
      callback({ path: path.normalize(requestedUrl) });
    }
  });

  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('second-instance', () => {
  const windows = BrowserWindow.getAllWindows();
  if (!windows.length) return;
  const win = windows[0];
  if (win.isMinimized()) win.restore();
  win.focus();
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});
