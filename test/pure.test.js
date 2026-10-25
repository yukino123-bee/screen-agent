'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { tidy } = require('../renderer/tidy');
const G = require('../src/geometry');
const A = require('../src/agents');
const { greetingKey, wavBuffer } = require('../src/audio');
const { cleanTranscript } = require('../src/transcript');

test('tidy drops markdown but keeps code', () => {
  assert.equal(tidy('**Hello** world'), 'Hello world');
  assert.equal(tidy('# Title\n* one\n* two'), 'Title\n\u2022 one\n\u2022 two');
  assert.equal(tidy('run `rm *.txt` now'), 'run `rm *.txt` now');
  assert.equal(tidy('```\n*x*\n```'), '```\n*x*\n```');
  assert.equal(tidy('2*3 is 6'), '2*3 is 6');
});

test('cropRect scales the selection onto the image', () => {
  const r = G.cropRect({ width: 2000, height: 1000 }, { x: 10, y: 20, w: 100, h: 50, vw: 1000, vh: 500 });
  assert.deepEqual(r, { x: 20, y: 40, width: 200, height: 100 });
  assert.throws(() => G.cropRect({ width: 100, height: 100 }, { x: 200, y: 0, w: 10, h: 10, vw: 100, vh: 100 }), /Empty/);
});

test('validSelection rejects bad input', () => {
  assert.equal(G.validSelection({ x: 0, y: 0, w: 5, h: 5, vw: 10, vh: 10 }), true);
  assert.equal(G.validSelection({ x: 0, y: 0, w: NaN, h: 5, vw: 10, vh: 10 }), false);
  assert.equal(G.validSelection({ x: 0, y: 0, w: 5, h: 5, vw: 0, vh: 10 }), false);
  assert.equal(G.validSelection(null), false);
});

test('displayRegion finds a monitor inside a whole-desktop image', () => {
  const bounds = [{ x: 0, y: 0, width: 1920, height: 1080 }, { x: 1920, y: 0, width: 1920, height: 1080 }];
  const r = G.displayRegion({ width: 3840, height: 1080 }, bounds, bounds[1]);
  assert.deepEqual(r, { x: 1920, y: 0, width: 1920, height: 1080 });
});

test('mergeAgents applies defaults, user overrides and drops invalid agents', () => {
  const m = A.mergeAgents({
    agy: { args: ['--x'] },
    mine: { label: 'Mine', command: 'mine', args: ['--go'], resumeArgs: ['--resume', '{id}'] },
    broken: { label: 'No command' },
    bad: 5,
  });
  assert.deepEqual(m.agy.args, ['--x']);
  assert.deepEqual(m.agy.planArgs, ['--mode', 'plan']); // default kept
  assert.equal(m.mine.format, 'text');
  assert.deepEqual(m.mine.planArgs, []);
  assert.equal(m.broken, undefined);
  assert.equal(m.bad, undefined);
  assert.equal(A.usesSessionIds(m.claude), true);
  assert.equal(A.usesSessionIds(m.mine), false);
  assert.deepEqual(A.fillId(m.claude.resumeArgs, 'abc'), ['--resume', 'abc']);
});

test('stream parser turns Claude Code JSON lines into events', () => {
  const p = A.createStreamParser();
  const lines = [
    { type: 'system', subtype: 'init', session_id: 'S1' },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'Hi' }, { type: 'tool_use', name: 'Edit', input: { file_path: 'C:\\x\\main.js' } }] } },
    { type: 'result', subtype: 'success', is_error: false, result: 'Hi', session_id: 'S1' },
  ].map((o) => JSON.stringify(o)).join('\n') + '\n';
  // fed in awkward pieces
  const ev = [...p.feed(lines.slice(0, 40)), ...p.feed(lines.slice(40))];
  assert.deepEqual(ev.map((e) => e.type), ['init', 'text', 'tool', 'result']);
  assert.equal(ev[0].sessionId, 'S1');
  assert.equal(ev[2].text, 'Editing main.js');
  assert.equal(ev[3].isError, false);
  assert.deepEqual(p.feed('plain words\n'), [{ type: 'text', text: 'plain words\n' }]);
  assert.equal(p.feed('{"type":"result","subtype":"error_max_turns"}').length, 0);
  assert.equal(p.flush()[0].isError, true);
});

test('ansi stripper handles escape codes split across chunks', () => {
  const strip = A.createAnsiStripper();
  assert.equal(strip('a\x1B[3'), 'a');
  assert.equal(strip('1mb\x1B[0m'), 'b');
  assert.equal(strip('plain'), 'plain');
});

test('greetingKey follows the clock', () => {
  const at = (h) => greetingKey(new Date(2026, 0, 1, h));
  assert.deepEqual([at(3), at(4), at(11), at(12), at(17), at(18)], ['evening', 'morning', 'morning', 'afternoon', 'afternoon', 'evening']);
});

test('wavBuffer writes a valid header', () => {
  const b = wavBuffer(new Float32Array([0, 1, -1]), 24000);
  assert.equal(b.toString('ascii', 0, 4), 'RIFF');
  assert.equal(b.readUInt32LE(24), 24000);
  assert.equal(b.readInt16LE(46), 32767);
  assert.equal(b.length, 44 + 6);
});

test('cleanTranscript drops noise and hallucinations', () => {
  assert.equal(cleanTranscript(' [BLANK_AUDIO] '), '');
  assert.equal(cleanTranscript('Thank you.'), '');
  assert.equal(cleanTranscript('Thanks for watching!'), '');
  assert.equal(cleanTranscript('open the settings page'), 'open the settings page');
});
