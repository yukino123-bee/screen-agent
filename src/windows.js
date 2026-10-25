'use strict';
const { BrowserWindow, screen } = require('electron');
const path = require('path');
const settings = require('./settings');
const { state } = require('./state');

const TOGGLE_SIZE = 56;
const chatW = () => settings.get('chatWidth');
const chatH = () => settings.get('chatHeight');

function webPrefs() {
  return {
    preload: path.join(__dirname, '..', 'preload.js'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
  };
}

const page = (name) => path.join(__dirname, '..', 'renderer', name);

function createToggle() {
  const wa = screen.getPrimaryDisplay().workArea;
  const win = new BrowserWindow({
    width: TOGGLE_SIZE, height: TOGGLE_SIZE,
    x: wa.x + wa.width - TOGGLE_SIZE - 24,
    y: wa.y + wa.height - TOGGLE_SIZE - 24,
    frame: false, transparent: true, resizable: false, maximizable: false,
    minimizable: false, fullscreenable: false, skipTaskbar: true, hasShadow: false,
    alwaysOnTop: true, show: false, webPreferences: webPrefs(),
  });
  state.toggleWin = win;
  win.setAlwaysOnTop(true, 'screen-saver');
  win.loadFile(page('toggle.html'));
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => { state.toggleWin = null; });
}

function createChat() {
  const win = new BrowserWindow({
    width: chatW(), height: chatH(), frame: false, resizable: false,
    maximizable: false, minimizable: false, fullscreenable: false,
    skipTaskbar: true, alwaysOnTop: true, show: false,
    transparent: true, hasShadow: false, backgroundColor: '#00000000',
    webPreferences: { ...webPrefs(), backgroundThrottling: false }, // keep voice running while hidden
  });
  state.chatWin = win;
  win.setAlwaysOnTop(true, 'screen-saver');
  win.loadFile(page('chat.html'));
  // Closing the panel only hides it, so the agent session and voice keep running.
  win.on('close', (e) => { if (!state.quitting) { e.preventDefault(); win.hide(); } });
  win.on('closed', () => {
    state.chatWin = null;
    if (!state.quitting) { createChat(); showChat(); } // never leave the app without its panel
  });
}

function positionChat() {
  const { chatWin, toggleWin } = state;
  if (!chatWin || chatWin.isDestroyed() || !toggleWin || toggleWin.isDestroyed()) return;
  const W = chatW();
  const H = chatH();
  const tb = toggleWin.getBounds();
  const wa = screen.getDisplayMatching(tb).workArea;
  const gap = 8;
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
  const leftX = tb.x - gap - W;
  const rightX = tb.x + tb.width + gap;
  let x;
  let y;
  if (leftX >= wa.x || rightX + W <= wa.x + wa.width) {
    // Beside the toggle (left if there is room, else right), so the toggle is never covered.
    x = leftX >= wa.x ? leftX : rightX;
    y = clamp(tb.y + tb.height - H, wa.y, wa.y + wa.height - H); // bottom edges aligned
  } else {
    // Screen too narrow for a side placement: above the toggle, or below if there is no room.
    x = clamp(tb.x + tb.width - W, wa.x, wa.x + wa.width - W);
    y = tb.y - H - gap;
    if (y < wa.y) y = clamp(tb.y + tb.height + gap, wa.y, wa.y + wa.height - H);
  }
  chatWin.setBounds({ x: Math.round(x), y: Math.round(y), width: W, height: H });
}

function showChat() {
  const { chatWin } = state;
  if (!chatWin || chatWin.isDestroyed()) return;
  positionChat();
  chatWin.show();
  chatWin.focus();
}

function toggleChat() {
  const { chatWin } = state;
  if (!chatWin) return;
  if (chatWin.isVisible()) chatWin.hide(); else showChat();
}

module.exports = { TOGGLE_SIZE, webPrefs, createToggle, createChat, positionChat, showChat, toggleChat };
