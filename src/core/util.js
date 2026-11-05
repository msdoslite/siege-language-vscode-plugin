'use strict';
function context(text, options = {}) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  const position = offset => {
    offset = Math.max(0, Math.min(text.length, offset));
    let lo = 0, hi = starts.length;
    while (lo + 1 < hi) { const mid = (lo + hi) >>> 1; if (starts[mid] <= offset) lo = mid; else hi = mid; }
    return { line: lo, character: offset - starts[lo] };
  };
  const result = { diagnostics: [], symbols: [], folds: [], links: [], tokens: [], occurrences: [], regions: [] };
  return { text, options, result, position,
    diagnostic(code, message, start, end = start + 1, severity = 'error', fix) {
      if (result.diagnostics.length >= (options.maxDiagnostics || 200)) return;
      result.diagnostics.push({ code, message, severity, start, end: Math.max(start, Math.min(text.length, end)), fix });
    },
    symbol(name, kind, start, end, detail = '', extra = {}) {
      const s = { name, kind, start, end, selectionStart: start, selectionEnd: end, detail, location: position(start), ...extra };
      result.symbols.push(s); return s;
    }
  };
}
function finish(c) {
  for (const d of c.result.diagnostics) d.range = { start: c.position(d.start), end: c.position(d.end) };
  return c.result;
}
const nameChar = c => c !== undefined && /[A-Za-z0-9_*$.-]/.test(c);
const numeric = /^[+-]?(?:0[xX][\da-fA-F]+|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)$/;
module.exports = { context, finish, nameChar, numeric };
