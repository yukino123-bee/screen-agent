'use strict';
const btn = document.getElementById('btn');
let down = null;
let moved = false;

btn.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  btn.setPointerCapture(e.pointerId);
  down = { x: e.screenX, y: e.screenY };
  moved = false;
  window.api.toggleDragStart(e.screenX, e.screenY);
});

btn.addEventListener('pointermove', (e) => {
  if (!down) return;
  if (!moved && Math.hypot(e.screenX - down.x, e.screenY - down.y) >= 5) moved = true;
  if (moved) window.api.toggleDragMove(e.screenX, e.screenY);
});

function finish(e) {
  if (!down) return;
  down = null;
  window.api.toggleDragEnd();
  if (!moved && e.type === 'pointerup') window.api.toggleClick();
}
btn.addEventListener('pointerup', finish);
btn.addEventListener('pointercancel', finish);

window.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  window.api.toggleMenu();
});

window.api.onToggleListening((on) => btn.classList.toggle('listening', !!on));
window.api.onToggleWorking((on) => btn.classList.toggle('working', !!on));
