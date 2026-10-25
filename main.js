'use strict';
const { app, globalShortcut, session, powerMonitor } = require('electron');
const path = require('path');

app.setName('Screen agent');

const P = require('./src/platform');
const log = require('./src/log');
const settings = require('./src/settings');
const autostart = require('./src/autostart');
const cli = require('./src/cli');
const tts = require('./src/tts');
const asr = require('./src/asr');
const chat = require('./src/chat');
const snip = require('./src/snip');
const toggle = require('./src/toggle');
const { state } = require('./src/state');
const { createToggle, createChat, showChat } = require('./src/windows');

// On Wayland, windows cannot position themselves or stay on top reliably, so run through XWayland.
// Screenshots still use the desktop portal (see src/capture.js).
// The display backend is chosen before this file runs, so a plain launch restarts itself once with the flag.
const needsX11 = P.IS_WAYLAND && !process.argv.some((a) => a.startsWith('--ozone-platform'));
if (needsX11) {
  app.relaunch({ args: [...process.argv.slice(1), '--ozone-platform=x11'] });
  app.exit(0);
}

function registerHotkey() {
  const key = settings.get('hotkey');
  try { state.hotkeyOk = globalShortcut.register(key, () => snip.startSnip()); } catch (err) { log.error(err.message); }
  if (!state.hotkeyOk) {
    log.warn(`Could not register hotkey ${key} (already in use, or not allowed on this desktop). `
      + 'Use the Snip button, or bind a system shortcut to: electron . --snip');
  }
}

if (needsX11) {
  // relaunching with the flag; nothing else to do in this process
} else if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // A second launch shows the panel, or with --snip starts a snip (usable as a system-wide shortcut).
  app.on('second-instance', (_e, argv) => {
    if (argv.includes('--snip')) snip.startSnip(); else showChat();
  });

  app.whenReady().then(() => {
    log.init(path.join(app.getPath('userData'), 'logs'));
    log.info(`Screen agent starting on ${process.platform}${P.IS_WAYLAND ? ' (Wayland)' : ''}`);

    // Only the chat window may use the microphone (audio only).
    const allowMic = (wc, permission, details) => permission === 'media' && !!state.chatWin && !!wc
      && wc === state.chatWin.webContents && (!details || !details.mediaTypes || details.mediaTypes.every((t) => t === 'audio'));
    session.defaultSession.setPermissionRequestHandler((wc, permission, cb, details) => cb(allowMic(wc, permission, details)));
    session.defaultSession.setPermissionCheckHandler((wc, permission, _origin, details) => allowMic(wc, permission, details));

    asr.register();
    snip.register();
    chat.register();
    toggle.register();

    cli.ensureWorkdir();
    cli.purgeSnips(false); // anything left over from a crash
    createToggle();
    createChat();

    // Start at login: on by default the first time, then whatever the user chose in the menu.
    if (settings.stored().autostart === undefined) {
      try { autostart.apply(true); settings.update({ autostart: true }); } catch (err) { log.error('autostart:', err.message); }
    }

    // Greet by the time of day, then make sure every clip is rendered for next time.
    if (!process.env.SCREEN_AGENT_QUIET) {
      setTimeout(() => {
        tts.announce(tts.greetingKey());
        tts.ensurePhrases(Object.keys(tts.PHRASES));
      }, 1500);
    }

    // Say goodnight when the computer shuts down. Linux and macOS report it and let us delay it briefly;
    // Windows only reports the session ending on a window, and ends the app almost at once.
    powerMonitor.on('shutdown', (e) => {
      e.preventDefault();
      state.quitting = true;
      const done = () => app.quit();
      tts.announce('goodnight').then(done, done);
      setTimeout(done, 8000);
    });
    if (state.toggleWin) state.toggleWin.on('session-end', () => { tts.announce('goodnight'); });

    registerHotkey();
    if (process.argv.includes('--snip')) snip.startSnip();
  });

  app.on('will-quit', () => globalShortcut.unregisterAll());
  app.on('before-quit', () => {
    state.quitting = true;
    cli.killCli(true);
    cli.purgeSnips(true);
    tts.stopSpeech();
    tts.releaseWorker();
  });
  app.on('window-all-closed', () => app.quit());
}
