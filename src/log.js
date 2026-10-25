'use strict';
const fs = require('fs');
const path = require('path');
const util = require('util');

const MAX_BYTES = 1024 * 1024;
let file = null;

function init(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    file = path.join(dir, 'app.log');
    if (fs.existsSync(file) && fs.statSync(file).size > MAX_BYTES) fs.renameSync(file, file + '.old');
  } catch {
    file = null;
  }
}

function write(level, args) {
  const line = `${new Date().toISOString()} ${level} ${util.format(...args)}`;
  (level === 'error' ? console.error : console.log)(line);
  if (file) { try { fs.appendFileSync(file, line + '\n'); } catch { /* disk full or locked */ } }
}

module.exports = {
  init,
  info: (...a) => write('info', a),
  warn: (...a) => write('warn', a),
  error: (...a) => write('error', a),
};
