'use strict';
// Pure rectangle math for snips, so it can be tested without Electron.

// Maps a selection made in the overlay (CSS pixels of a vw x vh view) onto an image of `size`.
function cropRect(size, rect) {
  const sx = size.width / rect.vw;
  const sy = size.height / rect.vh;
  const x = Math.max(0, Math.round(rect.x * sx));
  const y = Math.max(0, Math.round(rect.y * sy));
  const width = Math.min(size.width - x, Math.round(rect.w * sx));
  const height = Math.min(size.height - y, Math.round(rect.h * sy));
  if (width < 1 || height < 1) throw new Error('Empty selection.');
  return { x, y, width, height };
}

function validSelection(rect) {
  const nums = ['x', 'y', 'w', 'h', 'vw', 'vh'];
  return !!rect && nums.every((k) => Number.isFinite(rect[k])) && rect.vw > 0 && rect.vh > 0;
}

// Bounding box of several display bounds.
function unionBounds(list) {
  const x = Math.min(...list.map((b) => b.x));
  const y = Math.min(...list.map((b) => b.y));
  return {
    x, y,
    width: Math.max(...list.map((b) => b.x + b.width)) - x,
    height: Math.max(...list.map((b) => b.y + b.height)) - y,
  };
}

// Region of a whole-desktop image (all monitors) that belongs to `display`.
function displayRegion(imageSize, allBounds, display) {
  const u = unionBounds(allBounds);
  const sx = imageSize.width / u.width;
  const sy = imageSize.height / u.height;
  const x = Math.max(0, Math.round((display.x - u.x) * sx));
  const y = Math.max(0, Math.round((display.y - u.y) * sy));
  return {
    x, y,
    width: Math.min(imageSize.width - x, Math.round(display.width * sx)),
    height: Math.min(imageSize.height - y, Math.round(display.height * sy)),
  };
}

module.exports = { cropRect, validSelection, unionBounds, displayRegion };
