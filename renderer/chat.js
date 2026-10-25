'use strict';
const $ = (id) => document.getElementById(id);
const els = {
  folder: $('folder'), state: $('state'), stateText: $('stateText'), agent: $('agentSelect'),
  messages: $('messages'), attachments: $('attachments'), input: $('input'),
  activity: $('activity'), send: $('btnSend'), stop: $('btnStop'), mic: $('btnMic'), vstatus: $('voiceStatus'),
};

let info = { agents: [] };
let currentAgent = '';
let attachments = [];
let busy = false;
let cliBlock = null;
let cliRaw = '';
let mode = 'chat';
let runMode = 'chat';
let announcing = false;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function scrollDown() {
  els.messages.scrollTop = els.messages.scrollHeight;
}

function add(node) {
  const empty = $('empty');
  if (empty) empty.remove();
  els.messages.appendChild(node);
  scrollDown();
  return node;
}

function refreshUi() {
  els.send.disabled = busy;
  els.stop.hidden = !(busy && cliBlock);
}

const MODE_HINTS = {
  chat: 'Ask about your snip...',
  plan: 'Describe what you want planned...',
  build: 'Describe what to build...',
};
const WORKING_LABEL = { chat: 'Thinking', plan: 'Planning', build: 'Building' };

try { const saved = localStorage.getItem('mode'); if (saved in MODE_HINTS) mode = saved; } catch { /* storage unavailable */ }

function updateState() {
  const working = busy;
  const label = working ? WORKING_LABEL[runMode] + '...' : (micOn ? 'Listening' : 'Idle');
  els.stateText.textContent = label;
  els.state.classList.toggle('active', working);
  els.state.classList.toggle('listening', !working && micOn);
}

function setMode(next) {
  mode = next;
  try { localStorage.setItem('mode', mode); } catch { /* storage unavailable */ }
  for (const b of document.querySelectorAll('button.mode')) b.setAttribute('aria-checked', String(b.dataset.mode === mode));
  els.input.placeholder = MODE_HINTS[mode];
}

function setBusy(v) {
  busy = v;
  if (!v) cliBlock = null;
  updateState();
  refreshUi();
}

function renderAttachments() {
  els.attachments.textContent = '';
  els.attachments.hidden = attachments.length === 0;
  attachments.forEach((url, i) => {
    const wrap = el('div', 'att');
    const img = el('img');
    img.src = url;
    const rm = el('button', null, '×');
    rm.title = 'Remove';
    rm.addEventListener('click', () => {
      attachments.splice(i, 1);
      renderAttachments();
    });
    wrap.append(img, rm);
    els.attachments.appendChild(wrap);
  });
}

function addUser(text, images) {
  const box = el('div', 'msg user');
  if (images.length) {
    const t = el('div', 'thumbs');
    for (const url of images) {
      const img = el('img');
      img.src = url;
      t.appendChild(img);
    }
    box.appendChild(t);
  }
  if (text) box.appendChild(el('div', null, text));
  add(box);
}

// ---- history: kept across restarts until "New" (screenshots are not stored) ----
const HISTORY_MAX = 100;
let history = [];

function loadHistory() {
  try { history = JSON.parse(localStorage.getItem('history')) || []; } catch { history = []; }
  if (!Array.isArray(history)) history = [];
}

function remember(cls, text) {
  history.push({ cls, text });
  if (history.length > HISTORY_MAX) history = history.slice(-HISTORY_MAX);
  try { localStorage.setItem('history', JSON.stringify(history)); } catch { /* storage unavailable */ }
}

function forgetAll() {
  history = [];
  try { localStorage.removeItem('history'); } catch { /* storage unavailable */ }
}

function restoreHistory() {
  for (const m of history) add(el('div', 'msg ' + m.cls, m.text));
}

// Streamed text is drawn at most once per frame, however fast it arrives.
let drawQueued = false;
function drawCli() {
  if (drawQueued) return;
  drawQueued = true;
  requestAnimationFrame(() => {
    drawQueued = false;
    if (cliBlock) { cliBlock.textContent = window.tidy(cliRaw); scrollDown(); }
  });
}

function setActivity(text) {
  els.activity.textContent = text || '';
  els.activity.hidden = !text;
}

function handleEvent(ev) {
  switch (ev.type) {
    case 'text': add(el('div', 'msg assistant', ev.text)); remember('assistant', ev.text); break;
    case 'cli-start':
      cliBlock = add(el('div', 'msg assistant'));
      cliRaw = '';
      refreshUi();
      break;
    case 'cli-data':
      if (cliBlock) { cliRaw += ev.text; drawCli(); }
      break;
    case 'cli-activity': setActivity(ev.text); break;
    case 'cli-end':
      if (cliBlock) {
        cliBlock.textContent = window.tidy(cliRaw);
        if (!cliBlock.textContent.trim()) cliBlock.remove(); else remember('assistant', cliBlock.textContent);
      }
      cliBlock = null;
      setActivity('');
      add(el('div', 'msg status', ev.message));
      remember('status', ev.message);
      refreshUi();
      break;
    case 'announce': announcing = ev.on; syncListening(); break;
    case 'voice-status': voiceStatus(ev.text); break;
    case 'error': add(el('div', 'msg error', ev.message)); remember('error', ev.message); break;
    case 'done': setBusy(false); setActivity(''); syncListening(); break;
    default: break;
  }
}

async function send(viaVoice) {
  if (busy) return;
  const text = els.input.value.trim();
  const images = attachments.slice();
  if (!text && !images.length) return;
  els.input.value = '';
  attachments = [];
  renderAttachments();
  runMode = mode;
  addUser(text, images);
  remember('user', (images.length ? `[${images.length} screenshot${images.length > 1 ? 's' : ''}] ` : '') + text);
  setBusy(true);
  syncListening();
  try {
    await window.api.send({ text, images, mode, voice: viaVoice === true });
  } catch (err) {
    add(el('div', 'msg error', String(err.message || err)));
    setBusy(false);
  }
}

function fillAgents() {
  els.agent.textContent = '';
  for (const a of info.agents) {
    const o = el('option', null, a.label);
    o.value = a.id;
    els.agent.appendChild(o);
  }
  els.agent.value = currentAgent;
}

// ---- voice: talk to the agent, and hear its reply ----
const SVG_NS = 'http://www.w3.org/2000/svg';
const ICONS = {
  mic: [['rect', { x: 9, y: 3, width: 6, height: 11, rx: 3 }], ['path', { d: 'M5 11a7 7 0 0 0 14 0M12 18v3' }]],
};

function setIcon(btn, name) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  for (const [tag, attrs] of ICONS[name]) {
    const n = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    svg.appendChild(n);
  }
  btn.textContent = '';
  btn.appendChild(svg);
}

const SEND_DELAY_MS = 2000;
let micOn = false;
let sendTimer = null;
let transcribing = false;


function voiceStatus(text) {
  els.vstatus.textContent = text;
  els.vstatus.hidden = !text;
}

function cancelPendingSend(msg) {
  if (!sendTimer) return;
  clearTimeout(sendTimer);
  sendTimer = null;
  voiceStatus(msg || '');
}

// The mic only listens while the agent is idle and nothing is being spoken, so it never hears the reply.
function syncListening() {
  if (!micOn) return;
  if (busy || announcing || transcribing || sendTimer) voice.pause(); else { voice.resume(); voiceStatus('Listening... just speak.'); }
}

const voice = window.createVoice({
  onState(s) {
    els.mic.classList.toggle('hearing', s === 'speech');
    if (s === 'speech') voiceStatus('Hearing you...');
  },
  async onSpeech(samples) {
    transcribing = true;
    syncListening();
    voiceStatus('Transcribing...');
    const res = await window.api.transcribe(samples);
    transcribing = false;
    if (!micOn) return;
    if (!res.ok) { voiceStatus('Speech recognition failed: ' + res.error); syncListening(); return; }
    const heard = res.text;
    if (heard) els.input.value = els.input.value ? els.input.value + ' ' + heard : heard;
    if (!heard) { syncListening(); return; }
    if (mode === 'build') {
      // Speech can be misheard, so it never starts a build by itself.
      voiceStatus(`Heard: "${heard}". Press Enter to build, or switch to Chat or Plan to send by voice.`);
      syncListening();
      return;
    }
    voiceStatus(`Heard: "${heard}". Sending in 2 seconds. Press Esc or type to cancel.`);
    sendTimer = setTimeout(() => { sendTimer = null; voiceStatus(''); send(true); }, SEND_DELAY_MS);
    syncListening();
  },
});

async function setMic(on) {
  if (on === micOn) return;
  if (!on) {
    micOn = false;
    cancelPendingSend();
    voice.stop();
    voiceStatus('');
  } else {
    try {
      voiceStatus('Starting microphone...');
      await voice.start();
      micOn = true;
      window.api.voicePrepare().then((r) => { if (!r.ok) voiceStatus('Could not load the speech model: ' + r.error); });
      syncListening();
    } catch (err) {
      voiceStatus('Microphone unavailable: ' + (err.message || err));
      return;
    }
  }
  els.mic.setAttribute('aria-pressed', String(micOn));
  window.api.voiceActive(micOn);
  updateState();
}

els.mic.addEventListener('click', () => setMic(!micOn));
els.input.addEventListener('input', () => cancelPendingSend('Voice send cancelled.'));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && sendTimer) { cancelPendingSend('Voice send cancelled. Edit the text, then press Enter.'); syncListening(); }
});
setIcon(els.mic, 'mic');

for (const b of document.querySelectorAll('button.mode')) b.addEventListener('click', () => setMode(b.dataset.mode));
setMode(mode);

function renderEmpty() {
  const old = $('empty');
  if (old) old.remove();
  if (els.messages.childElementCount) return;
  const box = el('div', 'empty');
  box.id = 'empty';
  box.appendChild(el('div', 'e-title', 'Snip your screen and ask'));
  const hint = el('div', null, 'Press ');
  if (info.hotkey) {
    hint.appendChild(el('kbd', null, info.hotkey.replace('Control', 'Ctrl')));
    hint.appendChild(document.createTextNode(' or click Snip, then describe what you need.'));
  } else {
    hint.textContent = 'Click Snip, then describe what you need.';
  }
  box.appendChild(hint);
  els.messages.appendChild(box);
}

async function init() {
  info = await window.api.getInfo();
  currentAgent = info.selected;
  els.folder.textContent = info.workdir.length > 30 ? '\u2026' + info.workdir.slice(-29) : info.workdir;
  els.folder.title = info.workdir;
  fillAgents();
  refreshUi();
  loadHistory();
  restoreHistory();
  renderEmpty();
}

els.agent.addEventListener('change', async () => {
  const res = await window.api.selectAgent(els.agent.value);
  currentAgent = res.id;
  els.agent.value = currentAgent;
  refreshUi();
  renderEmpty();
});

els.input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    send();
  }
});
els.send.addEventListener('click', send);
els.stop.addEventListener('click', () => window.api.stop());
$('btnSnip').addEventListener('click', () => window.api.startSnip());
$('btnClose').addEventListener('click', () => window.api.closeChat());
$('btnNew').addEventListener('click', () => window.api.newChat());

window.api.onChatEvent(handleEvent);
window.api.onSnip((url) => {
  attachments.push(url);
  renderAttachments();
  els.input.focus();
});
window.api.onReset(() => {
  cancelPendingSend();
  forgetAll();
  setActivity('');
  els.messages.textContent = '';
  attachments = [];
  renderAttachments();
  setBusy(false);
  renderEmpty();
});

init();
