'use strict';
// Cleans up Whisper output. Pure, so it can be tested.

// Phrases Whisper tends to invent from silence or background noise.
const NOISE_PHRASES = new Set([
  'you', 'thank you', 'thanks', 'thanks for watching', 'thank you for watching', 'thank you very much',
  'bye', 'bye bye', 'please subscribe', 'the end',
]);

// Returns '' for text that is not real speech.
function cleanTranscript(raw) {
  const text = String(raw || '').trim();
  if (/^[[(*].*[\])*]$/.test(text)) return ''; // [BLANK_AUDIO], (music), *sigh*
  const norm = text.toLowerCase().replace(/[^a-z' ]/g, '').replace(/\s+/g, ' ').trim();
  if (!norm || NOISE_PHRASES.has(norm)) return '';
  return text;
}

module.exports = { cleanTranscript };
