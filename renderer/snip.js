'use strict';
const MIN_SIZE = 8;
const shot = document.getElementById('shot');
const dim = document.getElementById('dim');
const sel = document.getElementById('sel');
const label = document.getElementById('label');
const hint = document.getElementById('hint');
let start = null;
let rect = null;

window.api.onSnipInit(({ dataUrl }) => {
  shot.onload = () => window.api.snipReady();
  shot.src = dataUrl;
});

function currentRect(e) {
  const x = Math.min(start.x, e.clientX);
  const y = Math.min(start.y, e.clientY);
  return { x, y, w: Math.abs(e.clientX - start.x), h: Math.abs(e.clientY - start.y) };
}

window.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  start = { x: e.clientX, y: e.clientY };
  rect = null;
  dim.style.display = 'none';
  hint.style.display = 'none';
  sel.style.display = 'block';
  document.body.setPointerCapture(e.pointerId);
});

window.addEventListener('pointermove', (e) => {
  if (!start) return;
  rect = currentRect(e);
  sel.style.left = rect.x + 'px';
  sel.style.top = rect.y + 'px';
  sel.style.width = rect.w + 'px';
  sel.style.height = rect.h + 'px';
  label.textContent = `${Math.round(rect.w)} x ${Math.round(rect.h)}`;
  label.style.top = rect.y < 28 ? (rect.h + 4) + 'px' : '-24px';
});

window.addEventListener('pointerup', (e) => {
  if (!start || e.button !== 0) return;
  const r = currentRect(e);
  start = null;
  if (r.w < MIN_SIZE || r.h < MIN_SIZE) {
    sel.style.display = 'none';
    dim.style.display = 'block';
    hint.style.display = 'block';
    return;
  }
  window.api.snipDone({ ...r, vw: window.innerWidth, vh: window.innerHeight });
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.api.snipCancel();
});
window.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  window.api.snipCancel();
});
