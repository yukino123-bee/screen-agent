'use strict';
// Chat IPC: sending messages to the selected agent, stopping, resetting.
const { ipcMain } = require('electron');
const cli = require('./cli');
const tts = require('./tts');
const log = require('./log');
const { showChat } = require('./windows');
const settings = require('./settings');
const { state, emit, fromWindow } = require('./state');

let busy = false;
let selectedAgent = 'claude';

function setToggleWorking(on) {
  const w = state.toggleWin;
  if (w && !w.isDestroyed()) w.webContents.send('toggle:working', on);
}

function newChat() {
  busy = false;
  setToggleWorking(false);
  cli.resetChat();
  cli.purgeSnips(true); // the conversation is gone, so are the screenshots
  tts.stopSpeech();
  if (state.chatWin && !state.chatWin.isDestroyed()) state.chatWin.webContents.send('chat:reset');
}

// "The build is finished" is spoken from here, so it does not depend on the panel being open.
async function announceBuild(ok) {
  emit({ type: 'announce', on: true });
  try { await tts.announce(ok ? 'buildDone' : 'buildFailed'); } finally { emit({ type: 'announce', on: false }); }
}

function register() {
  ipcMain.handle('app:info', (e) => {
    if (!fromWindow(e, state.chatWin)) return null;
    return {
      workdir: cli.WORKDIR, agents: cli.agentList(), selected: selectedAgent,
      hotkey: state.hotkeyOk ? settings.get('hotkey') : '', defaultMode: settings.get('defaultMode'),
    };
  });

  ipcMain.handle('agent:select', async (e, id) => {
    if (!fromWindow(e, state.chatWin)) return { ok: false, id: selectedAgent };
    if (!cli.agentList().some((a) => a.id === id)) return { ok: false, id: selectedAgent };
    if (!(await cli.confirmCli(id))) return { ok: false, id: selectedAgent };
    selectedAgent = id;
    return { ok: true, id };
  });

  ipcMain.on('chat:close', (e) => { if (fromWindow(e, state.chatWin)) state.chatWin.hide(); });
  ipcMain.on('chat:new', (e) => { if (fromWindow(e, state.chatWin)) newChat(); });
  ipcMain.on('chat:stop', (e) => { if (fromWindow(e, state.chatWin)) cli.killCli(true); });
  // The toggle button pulses while the microphone is on.
  ipcMain.on('voice:active', (e, on) => {
    if (!fromWindow(e, state.chatWin)) return;
    if (state.toggleWin && !state.toggleWin.isDestroyed()) state.toggleWin.webContents.send('toggle:listening', !!on);
  });
  ipcMain.on('chat:show', (e) => { if (fromWindow(e, state.chatWin)) showChat(); });

  ipcMain.handle('chat:send', async (e, payload) => {
    if (!fromWindow(e, state.chatWin) || busy || !payload) return;
    const text = String(payload.text || '').trim();
    const images = (Array.isArray(payload.images) ? payload.images : [])
      .filter((s) => typeof s === 'string' && s.startsWith('data:image/png;base64,'));
    if (!text && !images.length) return;
    let mode = cli.MODES.includes(payload.mode) ? payload.mode : 'chat';
    // Speech can be misheard or come from a video playing nearby: it never gets to change anything.
    if (payload.voice && mode === 'build') mode = 'plan';

    busy = true;
    setToggleWorking(true);
    const gen = cli.currentGen();
    let result = { ok: false, aborted: true };
    try {
      result = await cli.runCli(selectedAgent, text, images, mode);
    } catch (err) {
      log.error('send failed:', err.message);
      if (gen === cli.currentGen()) emit({ type: 'error', message: err.message || String(err) });
    } finally {
      if (gen === cli.currentGen()) { busy = false; emit({ type: 'done' }); }
      if (!busy) setToggleWorking(false);
    }
    if (mode === 'build' && gen === cli.currentGen() && !result.aborted) announceBuild(result.ok);
  });
}

module.exports = { register, newChat };
