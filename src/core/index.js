'use strict';
const { parseGas } = require('./gas');
const { parseSkrit } = require('./skrit');
const { parseFlick } = require('./flick');
const { parseList } = require('./lists');
const { context } = require('./util');
function languageFor(path) {
  const name = path.replace(/\\/g, '/').split('/').pop().toLowerCase();
  if (name === '$required') return 'required';
  if (name === 'startup_verify.gpg') return 'gpg';
  if (/\.gas$/.test(name)) return 'gas';
  if (/\.skrit$/.test(name)) return 'skrit';
  if (/\.flick$/.test(name)) return 'flick';
  if (/\.nnk$/.test(name)) return 'nnk';
  return null;
}
function analyze(text, language, options = {}) {
  const result = language === 'gas' ? parseGas(text, options) : language === 'skrit' ? parseSkrit(text, options) : language === 'flick' ? parseFlick(text, options) : parseList(text, options, language);
  if (language === 'gas') {
    const c = context(text, options);
    for (const region of result.regions) {
      const sub = parseSkrit(text.slice(region.start, region.end), options);
      for (const d of sub.diagnostics) result.diagnostics.push({ ...d, start: d.start + region.start, end: d.end + region.start, range: { start: c.position(d.start + region.start), end: c.position(d.end + region.start) }, fix: d.fix ? { ...d.fix, start: d.fix.start + region.start, end: d.fix.end + region.start } : undefined });
      for (const s of sub.symbols) result.symbols.push({ ...s, start: s.start + region.start, end: s.end + region.start, selectionStart: s.selectionStart + region.start, selectionEnd: s.selectionEnd + region.start, location: c.position(s.selectionStart + region.start), embedded: true });
      for (const t of sub.tokens) result.tokens.push({ ...t, start: t.start + region.start, end: t.end + region.start, embedded: true });
      for (const o of sub.occurrences) result.occurrences.push({ ...o, start: o.start + region.start, end: o.end + region.start, symbolStart: o.symbolStart === undefined ? undefined : o.symbolStart + region.start });
      for (const l of sub.links) result.links.push({ ...l, start: l.start + region.start, end: l.end + region.start });
      for (const f of sub.folds) result.folds.push({ start: f.start + region.start, end: f.end + region.start });
    }
  }
  result.diagnostics = result.diagnostics.slice(0, options.maxDiagnostics || 200);
  return result;
}
module.exports = { analyze, languageFor };
