'use strict';
// Start at login: a login item on Windows and macOS, an autostart .desktop entry on Linux.
const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const P = require('./platform');

function linuxFile() {
  return path.join(os.homedir(), '.config', 'autostart', 'screen-agent.desktop');
}

function loginArgs() {
  return app.isPackaged ? [] : [app.getAppPath()];
}

function apply(on) {
  if (P.IS_LINUX) {
    const file = linuxFile();
    if (!on) { try { fs.unlinkSync(file); } catch { /* not there */ } return; }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, [
      '[Desktop Entry]', 'Type=Application', 'Name=Screen agent',
      `Exec="${process.execPath}" ${loginArgs().map((a) => `"${a}"`).join(' ')}`.trim(), `Path=${app.getAppPath()}`,
      'X-GNOME-Autostart-enabled=true', '',
    ].join('\n'));
    return;
  }
  app.setLoginItemSettings({ openAtLogin: on, path: process.execPath, args: loginArgs() });
}

function enabled() {
  if (P.IS_LINUX) return fs.existsSync(linuxFile());
  return app.getLoginItemSettings({ path: process.execPath, args: loginArgs() }).openAtLogin;
}

module.exports = { apply, enabled };
