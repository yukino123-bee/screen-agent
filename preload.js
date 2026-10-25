'use strict';
const { contextBridge, ipcRenderer } = require('electron');

function on(channel, cb) {
  ipcRenderer.on(channel, (_e, payload) => cb(payload));
}

contextBridge.exposeInMainWorld('api', {
  // toggle button
  toggleDragStart: (x, y) => ipcRenderer.send('toggle:drag-start', { x, y }),
  toggleDragMove: (x, y) => ipcRenderer.send('toggle:drag-move', { x, y }),
  toggleDragEnd: () => ipcRenderer.send('toggle:drag-end'),
  toggleClick: () => ipcRenderer.send('toggle:click'),
  toggleMenu: () => ipcRenderer.send('toggle:menu'),

  // snip overlay
  onSnipInit: (cb) => on('snip:init', cb),
  snipReady: () => ipcRenderer.send('snip:ready'),
  snipDone: (rect) => ipcRenderer.send('snip:done', rect),
  snipCancel: () => ipcRenderer.send('snip:cancel'),

  // chat
  getInfo: () => ipcRenderer.invoke('app:info'),
  selectAgent: (id) => ipcRenderer.invoke('agent:select', id),
  send: (payload) => ipcRenderer.invoke('chat:send', payload),
  stop: () => ipcRenderer.send('chat:stop'),
  newChat: () => ipcRenderer.send('chat:new'),
  closeChat: () => ipcRenderer.send('chat:close'),
  voicePrepare: () => ipcRenderer.invoke('voice:prepare'),
  transcribe: (samples) => ipcRenderer.invoke('voice:transcribe', samples),
  voiceActive: (on) => ipcRenderer.send('voice:active', on),
  showChat: () => ipcRenderer.send('chat:show'),
  onToggleWorking: (cb) => on('toggle:working', cb),
  onToggleListening: (cb) => on('toggle:listening', cb),
  startSnip: () => ipcRenderer.send('snip:start'),
  onChatEvent: (cb) => on('chat:event', cb),
  onSnip: (cb) => on('chat:snip', cb),
  onReset: (cb) => on('chat:reset', cb),
});
