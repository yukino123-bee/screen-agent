'use strict';
const { BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const P = require('./platform');
const log = require('./log');
const G = require('./geometry');
const { captureDisplay } = require('./capture');
const { state, emit, fromWindow } = require('./state');
const { webPrefs, showChat } = require('./windows');

const MAX_IMAGE_WIDTH = 1568;

let snipCtx = null; // { image, restoreChat }
let snipStarting = false;

async function startSnip() {
  if (state.snipWin || snipStarting) return;
  snipStarting = true;
  const restoreChat = !!(state.chatWin && state.chatWin.isVisible());
  if (state.toggleWin) state.toggleWin.hide();
  if (state.chatWin) state.chatWin.hide();
  await P.sleep(250);

  try {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const image = await captureDisplay(display);
    snipCtx = { image, restoreChat };
    const b = display.bounds;
    const win = new BrowserWindow({
      x: b.x, y: b.y, width: b.width, height: b.height,
      frame: false, resizable: false, movable: false, minimizable: false,
      maximizable: false, fullscreenable: false, skipTaskbar: true, alwaysOnTop: true,
      show: false, hasShadow: false, backgroundColor: '#000000', webPreferences: webPrefs(),
    });
    state.snipWin = win;
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setBounds(b);
    win.on('closed', () => {
      state.snipWin = null;
      if (snipCtx) endSnip(); // closed some other way: bring the toggle back
    });
    win.webContents.once('did-finish-load', () => {
      if (state.snipWin) state.snipWin.webContents.send('snip:init', { dataUrl: image.toDataURL() });
    });
    win.loadFile(path.join(__dirname, '..', 'renderer', 'snip.html'));
  } catch (err) {
    log.error('snip failed:', err);
    endSnip(false);
    if (state.chatWin) { showChat(); emit({ type: 'error', message: 'Snip failed: ' + err.message }); }
  }
}

function endSnip(restoreChatWindow) {
  snipStarting = false;
  const ctx = snipCtx;
  snipCtx = null;
  if (state.snipWin && !state.snipWin.isDestroyed()) state.snipWin.destroy();
  state.snipWin = null;
  if (state.toggleWin) state.toggleWin.show();
  if (restoreChatWindow || (ctx && ctx.restoreChat && restoreChatWindow !== false)) showChat();
}

function cropSnip(rect) {
  let out = snipCtx.image.crop(G.cropRect(snipCtx.image.getSize(), rect));
  if (out.getSize().width > MAX_IMAGE_WIDTH) out = out.resize({ width: MAX_IMAGE_WIDTH, quality: 'best' });
  return 'data:image/png;base64,' + out.toPNG().toString('base64');
}

function register() {
  ipcMain.on('snip:ready', (e) => {
    if (fromWindow(e, state.snipWin)) { state.snipWin.show(); state.snipWin.focus(); }
  });

  ipcMain.on('snip:done', (e, rect) => {
    if (!fromWindow(e, state.snipWin) || !snipCtx) return;
    try {
      if (!G.validSelection(rect)) throw new Error('Bad selection.');
      const dataUrl = cropSnip(rect);
      endSnip(true);
      state.chatWin.webContents.send('chat:snip', dataUrl);
    } catch (err) {
      endSnip(true);
      emit({ type: 'error', message: 'Snip failed: ' + err.message });
    }
  });

  ipcMain.on('snip:cancel', (e) => {
    if (fromWindow(e, state.snipWin)) endSnip();
  });

  ipcMain.on('snip:start', (e) => {
    if (fromWindow(e, state.chatWin)) startSnip();
  });
}

module.exports = { register, startSnip };
