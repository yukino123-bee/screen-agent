'use strict';
// Takes a screenshot of one display with Electron's desktopCapturer. On Linux under Wayland that goes through
// the screen-share portal (a few seconds, and it may ask permission), so a screenshot tool is used first
// when one is installed (grim, spectacle, gnome-screenshot).
const { desktopCapturer, nativeImage, screen, app } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const P = require('./platform');
const log = require('./log');
const G = require('./geometry');

const CAPTURE_TIMEOUT_MS = 10 * 1000;

function timeout(ms, message) {
  let timer;
  const p = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); });
  return { p, clear: () => clearTimeout(timer) };
}

async function viaElectron(display) {
  const sf = display.scaleFactor || 1;
  const t = timeout(CAPTURE_TIMEOUT_MS, 'Screen capture timed out.');
  try {
    const sources = await Promise.race([
      desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: Math.round(display.size.width * sf), height: Math.round(display.size.height * sf) },
      }),
      t.p,
    ]);
    const idx = screen.getAllDisplays().findIndex((d) => d.id === display.id);
    const src = sources.find((s) => s.display_id === String(display.id)) || sources[idx] || sources[0];
    if (!src || src.thumbnail.isEmpty()) throw new Error('Screen capture returned no image.');
    return src.thumbnail;
  } finally { t.clear(); }
}

// Runs a command; resolves true when it exits 0 within the time limit.
function run(cmd, args) {
  return new Promise((resolve) => {
    let child;
    try { child = spawn(cmd, args, { stdio: 'ignore', windowsHide: true }); } catch { resolve(false); return; }
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } resolve(false); }, CAPTURE_TIMEOUT_MS);
    child.on('error', () => { clearTimeout(timer); resolve(false); });
    child.on('close', (code) => { clearTimeout(timer); resolve(code === 0); });
  });
}

function tmpFile() {
  return path.join(app.getPath('temp'), `screen-agent-${process.pid}-${Date.now()}.png`);
}

function readAndDelete(file) {
  try {
    const img = nativeImage.createFromPath(file);
    return img.isEmpty() ? null : img;
  } finally { try { fs.unlinkSync(file); } catch { /* not there */ } }
}

async function viaLinuxTools(display) {
  const file = tmpFile();
  const b = display.bounds;
  const tools = [
    ['grim', ['-g', `${b.x},${b.y} ${b.width}x${b.height}`, file], true],
    ['spectacle', ['-b', '-n', '-f', '-o', file], false],
    ['gnome-screenshot', ['-f', file], false],
  ];
  for (const [cmd, args, exactRegion] of tools) {
    if (!P.commandExists(cmd) || !(await run(cmd, args))) continue;
    const img = readAndDelete(file);
    if (img) return exactRegion ? img : cropToDisplay(img, display);
  }
  return null;
}

// Tools that grab the whole desktop: cut out the display the cursor is on.
function cropToDisplay(img, display) {
  const all = screen.getAllDisplays();
  if (all.length < 2) return img;
  return img.crop(G.displayRegion(img.getSize(), all.map((d) => d.bounds), display.bounds));
}

async function captureDisplay(display) {
  if (P.IS_WAYLAND) {
    try {
      const img = await viaLinuxTools(display);
      if (img) return img;
    } catch (err) { log.warn('Wayland capture failed, using Electron:', err.message); }
  }
  return viaElectron(display);
}

module.exports = { captureDisplay };
