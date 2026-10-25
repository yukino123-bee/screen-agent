'use strict';
// Window handles and flags shared between the main-process modules.
const state = {
  toggleWin: null,
  chatWin: null,
  snipWin: null,
  quitting: false,
  hotkeyOk: false,
};

function emit(ev) {
  const w = state.chatWin;
  if (w && !w.isDestroyed()) w.webContents.send('chat:event', ev);
}

function fromWindow(e, win) {
  return !!win && !win.isDestroyed() && e.sender === win.webContents;
}

module.exports = { state, emit, fromWindow };
