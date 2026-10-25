'use strict';
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';
const IS_LINUX = process.platform === 'linux';
const IS_WAYLAND = IS_LINUX && (process.env.XDG_SESSION_TYPE === 'wayland' || !!process.env.WAYLAND_DISPLAY);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function killTree(child) {
  if (!child || child.exitCode !== null || !child.pid) return;
  try {
    if (IS_WIN) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
    else process.kill(-child.pid, 'SIGKILL');
  } catch {
    try { child.kill('SIGKILL'); } catch { /* already gone */ }
  }
}

// True when `cmd` can be started: a path that exists, or a name found on PATH.
function commandExists(cmd) {
  const bare = String(cmd).trim().replace(/^"(.*)"$/, '$1');
  if (/[\\/]/.test(bare)) return fs.existsSync(bare);
  const r = IS_WIN
    ? spawnSync('where', [bare], { windowsHide: true, stdio: 'ignore' })
    : spawnSync('sh', ['-c', 'command -v "$1"', 'sh', bare], { stdio: 'ignore' });
  return r.status === 0;
}

module.exports = { IS_WIN, IS_MAC, IS_LINUX, IS_WAYLAND, sleep, killTree, commandExists };
