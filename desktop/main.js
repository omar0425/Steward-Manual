'use strict';

/**
 * Steward desktop shell — the hosted web app in its own window, with a
 * system-tray icon so it lives on the bar like a real desktop app.
 *
 * Design: a THIN shell. It loads the hosted Steward (your Railway URL) rather
 * than bundling the server, so the desktop app is always exactly as up to
 * date as production and your data stays in one place. Point it somewhere
 * else (e.g. a local dev server) with either:
 *   - the STEWARD_URL environment variable, or
 *   - a steward-desktop.json next to this file: { "url": "http://..." }
 *
 * Behavior:
 *   - Close button hides to the tray instead of quitting (the bar presence).
 *   - Tray: left-click toggles the window; right-click menu has Open,
 *     "Start when I log in", and Quit.
 *   - Single instance: launching again focuses the existing window.
 *   - External links open in the default browser, not inside the shell.
 */

const { app, BrowserWindow, Tray, Menu, shell, nativeImage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

// Auto-update from the repo's public GitHub Releases: checked at launch and
// every 6 hours, downloaded in the background, installed on quit. Only in the
// packaged app — `npm start` dev runs skip it entirely.
let autoUpdater = null;
try {
  ({ autoUpdater } = require('electron-updater'));
} catch (_) { /* dependency missing in a bare dev checkout — updates just off */ }

const DEFAULT_URL = 'https://steward-manual-production.up.railway.app';

function stewardUrl() {
  if (process.env.STEWARD_URL) return process.env.STEWARD_URL;
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'steward-desktop.json'), 'utf8'));
    if (cfg && typeof cfg.url === 'string' && /^https?:\/\//.test(cfg.url)) return cfg.url;
  } catch (_) { /* no config file — use the default */ }
  return DEFAULT_URL;
}

const APP_URL = stewardUrl();
const APP_ORIGIN = new URL(APP_URL).origin;
const ICON_PATH = path.join(__dirname, 'icons', 'icon-512.png');

let win = null;
let tray = null;
let quitting = false;

function createWindow() {
  win = new BrowserWindow({
    width: 1240,
    height: 860,
    minWidth: 380,
    minHeight: 600,
    backgroundColor: '#090c14', // app theme — no white flash while loading
    icon: ICON_PATH,
    autoHideMenuBar: true,
    webPreferences: {
      // Pure browser shell: the page gets no Node access at all.
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  win.loadURL(APP_URL);

  // Same-origin navigation stays in the shell; anything else (GitHub links,
  // docs, OAuth pages) belongs in the real browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (new URL(url).origin !== APP_ORIGIN) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (new URL(url).origin !== APP_ORIGIN) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });

  // The close button hides to the tray — Quit lives in the tray menu.
  win.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      win.hide();
    }
  });
}

function showWindow() {
  if (!win) createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createTray() {
  // Tray icons want small bitmaps; scale the app icon down for crispness.
  const image = nativeImage.createFromPath(ICON_PATH).resize({ width: 16, height: 16 });
  tray = new Tray(image);
  tray.setToolTip('Steward — debt climb');

  const rebuildMenu = () => {
    const login = app.getLoginItemSettings();
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Open Steward', click: showWindow },
      { type: 'separator' },
      {
        label: 'Start when I log in',
        type: 'checkbox',
        checked: login.openAtLogin,
        click: (item) => {
          app.setLoginItemSettings({ openAtLogin: item.checked });
          rebuildMenu();
        },
      },
      {
        label: 'Check for updates',
        enabled: !!(autoUpdater && app.isPackaged),
        click: () => { checkForUpdates(); },
      },
      { type: 'separator' },
      {
        label: 'Quit Steward',
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]));
  };
  rebuildMenu();

  // Left-click toggles the window (Windows convention; macOS uses the menu).
  tray.on('click', () => {
    if (win && win.isVisible()) win.hide();
    else showWindow();
  });
}

// Update check — silent when current; an OS notification appears once a new
// version has downloaded, and it installs on the next quit. Failures are
// logged and ignored: an update hiccup must never disturb the app itself.
function checkForUpdates() {
  if (!autoUpdater || !app.isPackaged) return;
  autoUpdater.checkForUpdatesAndNotify().catch((err) => {
    console.error('[updater]', err && err.message);
  });
}

// Second launch (double-clicking the shortcut again) focuses the running app.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', showWindow);

  app.whenReady().then(() => {
    createWindow();
    createTray();
    checkForUpdates();
    setInterval(checkForUpdates, 6 * 60 * 60 * 1000);
  });

  // macOS: dock icon click reopens the window.
  app.on('activate', showWindow);

  // Hidden-to-tray means the app must survive all windows being "closed".
  app.on('window-all-closed', () => {
    if (quitting) app.quit();
  });

  app.on('before-quit', () => { quitting = true; });
}
