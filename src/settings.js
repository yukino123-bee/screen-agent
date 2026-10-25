'use strict';
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const STYLE_PROMPT = 'Reply like a friendly human in plain, natural conversation. Do not use markdown: no asterisks, '
  + 'no bold or italics, no headings, no tables. Keep it short. Add an emoji now and then to show a reaction '
  + '(for example \u{1F60A} \u{1F44D} \u{1F62E} \u{1F605}), but no more than one or two. '
  + 'Commands and code may go in backticks.';

// Everything here can be overridden in settings.json (in the app's userData folder).
const DEFAULTS = {
  hotkey: 'Control+Alt+S',
  chatWidth: 400,
  chatHeight: 580,
  defaultMode: 'chat',
  voiceModel: 'Xenova/whisper-tiny.en', // English only. Use 'Xenova/whisper-tiny' for other languages.
  snipRetentionHours: 24,
  skipPromptWarning: false, // true: never show the "turn off permission prompts" dialog
  stylePrompt: STYLE_PROMPT,
};

function file() { return path.join(app.getPath('userData'), 'settings.json'); }

let cache = null;
function stored() {
  if (!cache) {
    try { cache = JSON.parse(fs.readFileSync(file(), 'utf8')) || {}; } catch { cache = {}; }
  }
  return cache;
}

function get(key) {
  const v = stored()[key];
  return v === undefined ? DEFAULTS[key] : v;
}

function update(patch) {
  cache = { ...stored(), ...patch };
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(cache, null, 2));
}

module.exports = { get, update, stored, DEFAULTS };
