'use strict';
// The floating button: dragging, clicking and its right-click menu.
const { app, ipcMain, Menu } = require('electron');
const { state, fromWindow } = require('./state');
const { TOGGLE_SIZE, positionChat, toggleChat } = require('./windows');
const { startSnip } = require('./snip');
const autostart = require('./autostart');
const settings = require('./settings');
const chat = require('./chat');

let dragStart = null;

function register() {
  ipcMain.on('toggle:drag-start', (e, p) => {
    if (!fromWindow(e, state.toggleWin)) return;
    dragStart = { x: p.x, y: p.y, bounds: state.toggleWin.getBounds() };
  });
  ipcMain.on('toggle:drag-move', (e, p) => {
    if (!fromWindow(e, state.toggleWin) || !dragStart) return;
    state.toggleWin.setBounds({
      x: Math.round(dragStart.bounds.x + p.x - dragStart.x),
      y: Math.round(dragStart.bounds.y + p.y - dragStart.y),
      width: TOGGLE_SIZE, height: TOGGLE_SIZE,
    });
    if (state.chatWin && state.chatWin.isVisible()) positionChat();
  });
  ipcMain.on('toggle:drag-end', (e) => {
    if (fromWindow(e, state.toggleWin)) dragStart = null;
  });
  ipcMain.on('toggle:click', (e) => {
    if (fromWindow(e, state.toggleWin)) toggleChat();
  });
  ipcMain.on('toggle:menu', (e) => {
    if (!fromWindow(e, state.toggleWin)) return;
    Menu.buildFromTemplate([
      { label: 'Snip screen', click: () => startSnip() },
      { label: 'New chat', click: () => chat.newChat() },
      { label: 'Start at login', type: 'checkbox', checked: autostart.enabled(), click: (item) => {
        autostart.apply(item.checked);
        settings.update({ autostart: item.checked });
      } },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]).popup({ window: state.toggleWin });
  });
}

module.exports = { register };
