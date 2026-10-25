'use strict';
// Agent definitions and the parsers for their output. Pure functions, no Electron.
const path = require('path');

// `{id}` in newSessionArgs / resumeArgs is replaced with the app's session id.
const DEFAULT_CLI = {
  claude: {
    label: 'Claude Code (no prompts)',
    command: 'claude',
    format: 'claude-stream',
    args: ['-p', '--dangerously-skip-permissions', '--output-format', 'stream-json', '--verbose'],
    planArgs: ['-p', '--permission-mode', 'plan', '--output-format', 'stream-json', '--verbose'], // read-only
    newSessionArgs: ['--session-id', '{id}'],
    resumeArgs: ['--resume', '{id}'],
    continueArgs: [],
    install: 'npm install -g @anthropic-ai/claude-code',
  },
  agy: {
    label: 'agy (no prompts)',
    command: 'agy',
    format: 'text',
    args: ['--dangerously-skip-permissions'],
    planArgs: ['--mode', 'plan'],
    newSessionArgs: [],
    resumeArgs: [],
    continueArgs: ['--continue'],
    install: 'agy install',
  },
};

const LIST_FIELDS = ['args', 'planArgs', 'continueArgs', 'newSessionArgs', 'resumeArgs'];

// Defaults, then the user's agents.json on top. `user` is the parsed file (or null).
function mergeAgents(user) {
  const merged = {};
  for (const [id, def] of Object.entries(DEFAULT_CLI)) merged[id] = { ...def };
  for (const [id, def] of Object.entries(user || {})) {
    if (!def || typeof def !== 'object') continue;
    merged[id] = { ...(merged[id] || { label: id, format: 'text' }), ...def };
  }
  for (const [id, def] of Object.entries(merged)) {
    if (typeof def.command !== 'string' || !def.command.trim()) { delete merged[id]; continue; }
    if (typeof def.label !== 'string') def.label = id;
    if (def.format !== 'claude-stream') def.format = 'text';
    for (const f of LIST_FIELDS) def[f] = Array.isArray(def[f]) ? def[f].map(String) : [];
  }
  return merged;
}

// An agent keeps its own conversation ids only if it can both create and resume one by id.
function usesSessionIds(def) {
  return def.newSessionArgs.length > 0 && def.resumeArgs.length > 0;
}

function fillId(args, id) {
  return args.map((a) => a.split('{id}').join(id));
}

// ---- Claude Code `--output-format stream-json` (one JSON object per line) ----
const TOOL_VERBS = {
  Read: 'Reading', Edit: 'Editing', MultiEdit: 'Editing', Write: 'Writing', NotebookEdit: 'Editing',
  Bash: 'Running', Grep: 'Searching', Glob: 'Finding files', WebFetch: 'Browsing', WebSearch: 'Searching the web',
  Task: 'Delegating', Agent: 'Delegating',
};

function describeTool(name, input) {
  const i = input || {};
  const verb = TOOL_VERBS[name] || `Using ${name}`;
  let target = '';
  if (typeof i.file_path === 'string') target = path.basename(i.file_path.replace(/\\/g, '/'));
  else if (typeof i.command === 'string') target = i.command.split('\n')[0].slice(0, 60);
  else if (typeof i.pattern === 'string') target = i.pattern.slice(0, 60);
  return target ? `${verb} ${target}` : verb;
}

// feed(chunk) returns events: {type:'init', sessionId} | {type:'text', text} | {type:'tool', text} |
// {type:'result', isError, text, sessionId}. A line that is not JSON is passed on as plain text.
function createStreamParser() {
  let buf = '';

  function lineEvents(line) {
    const s = line.trim();
    if (!s) return [];
    let obj;
    try { obj = JSON.parse(s); } catch { return [{ type: 'text', text: line + '\n' }]; }
    if (!obj || typeof obj !== 'object') return [];
    if (obj.type === 'system' && obj.subtype === 'init') return [{ type: 'init', sessionId: obj.session_id }];
    if (obj.type === 'assistant' && obj.message && Array.isArray(obj.message.content)) {
      const out = [];
      for (const b of obj.message.content) {
        if (b.type === 'text' && b.text) out.push({ type: 'text', text: b.text });
        else if (b.type === 'tool_use') out.push({ type: 'tool', text: describeTool(b.name, b.input) });
      }
      return out;
    }
    if (obj.type === 'result') {
      return [{
        type: 'result', isError: !!obj.is_error || (obj.subtype && obj.subtype !== 'success'),
        text: typeof obj.result === 'string' ? obj.result : '', sessionId: obj.session_id,
      }];
    }
    return [];
  }

  return {
    feed(chunk) {
      buf += chunk;
      const lines = buf.split('\n');
      buf = lines.pop();
      return lines.flatMap(lineEvents);
    },
    flush() {
      const rest = buf;
      buf = '';
      return lineEvents(rest);
    },
  };
}

// ---- plain terminal output ----
const ANSI = /\x1B\[[0-?]*[ -/]*[@-~]|\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)/g;
const ANSI_PARTIAL = /\x1B(?:\[[0-?]*[ -/]*|\][^\x07\x1B]*\x1B?)?$/;

// Removes ANSI codes even when an escape sequence is split across two chunks.
function createAnsiStripper() {
  let pending = '';
  return (chunk) => {
    let s = pending + chunk;
    pending = '';
    const m = ANSI_PARTIAL.exec(s);
    if (m) { pending = m[0]; s = s.slice(0, m.index); }
    return s.replace(ANSI, '');
  };
}

module.exports = {
  DEFAULT_CLI, mergeAgents, usesSessionIds, fillId, describeTool, createStreamParser, createAnsiStripper,
};
