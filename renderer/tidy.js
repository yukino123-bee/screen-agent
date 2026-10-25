'use strict';
// Agents sometimes write markdown anyway. Show it as plain text, but leave code and commands alone
// (an asterisk in `rm *.txt` or a code block is meaningful). Works in the page and in Node (tests).
(function (root) {
  function tidy(text) {
    return text.split(/(```[\s\S]*?```|`[^`\n]*`)/).map((part, i) => {
      if (i % 2) return part; // code
      return part
        .replace(/^([ \t]*)\*[ \t]+/gm, '$1• ') // "* item" bullets
        .replace(/^[ \t]*#{1,6}[ \t]+/gm, '')        // headings
        .replace(/(^|[\s(["'“])\*+(?=\S)/g, '$1')        // opening bold / italic marker
        .replace(/(?<=\S)\*+(?=$|[\s.,;:!?)\]"'”])/gm, ''); // closing marker (2*3 is left alone)
    }).join('');
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { tidy };
  else root.tidy = tidy;
})(typeof window !== 'undefined' ? window : globalThis);
