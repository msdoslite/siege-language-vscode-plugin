'use strict';
const { context, finish } = require('./util');
const grammar = require('../../data/flick-grammar.json').rules;
const byLhs = new Map(), terminals = new Set();
for (let i = 0; i < grammar.length; i++) { const [lhs, rhs] = grammar[i]; if (!byLhs.has(lhs)) byLhs.set(lhs, []); byLhs.get(lhs).push(i); for (const [type, value] of rhs) if (type === 'T') terminals.add(value); }
function earley(tokens, limit = 250000) {
  const charts = Array.from({ length: tokens.length + 1 }, () => ({ seen: new Set(), queue: [], waiting: new Map(), completed: new Set() }));
  let count = 0, farthest = 0;
  function add(at, rule, dot, start) {
    const ch = charts[at], key = `${rule}:${dot}:${start}`;
    if (ch.seen.has(key)) return;
    if (++count > limit) throw new Error('Flick analysis budget');
    ch.seen.add(key); ch.queue.push({ rule, dot, start });
  }
  add(0, 0, 0, 0);
  for (let pos = 0; pos < charts.length; pos++) {
    const ch = charts[pos]; if (ch.queue.length) farthest = pos;
    for (let i = 0; i < ch.queue.length; i++) {
      const s = ch.queue[i], [lhs, rhs] = grammar[s.rule];
      if (s.dot === rhs.length) {
        const key = lhs + ':' + s.start;
        if (ch.completed.has(key)) continue; ch.completed.add(key);
        for (const parent of charts[s.start].waiting.get(lhs) || []) add(pos, parent.rule, parent.dot + 1, parent.start);
      } else if (rhs[s.dot][0] === 'N') {
        const name = rhs[s.dot][1]; if (!ch.waiting.has(name)) ch.waiting.set(name, []); ch.waiting.get(name).push(s);
        for (const rule of byLhs.get(name)) add(pos, rule, 0, pos);
      } else if (pos < tokens.length && rhs[s.dot][1] === tokens[pos].id) add(pos + 1, s.rule, s.dot + 1, s.start);
    }
  }
  const accepted = charts[tokens.length].seen.has(`0:${grammar[0][1].length}:0`);
  const expected = new Set();
  for (const s of charts[farthest].queue) { const rhs = grammar[s.rule][1]; if (rhs[s.dot]?.[0] === 'T') expected.add(rhs[s.dot][1]); }
  return { accepted, farthest, expected: [...expected].slice(0, 10), states: count };
}
function parseFlick(text, options = {}) {
  const c = context(text, options), r = c.result, tokens = []; let i = 0;
  const push = (type, start, end, id) => { const t = { type, start, end, id, value: text.slice(start, end) }; r.tokens.push(t); if (id !== undefined) tokens.push(t); };
  while (i < text.length) {
    if (/\s/.test(text[i])) { i++; continue; }
    const start = i;
    if (text.startsWith('//', i)) { i = text.indexOf('\n', i); if (i < 0) i = text.length; push('comment', start, i); continue; }
    if (text.startsWith('/*', i)) { const end = text.indexOf('*/', i + 2); i = end < 0 ? text.length : end + 2; if (end < 0) c.diagnostic('flick.comment', 'Unclosed block comment.', start, i); push('comment', start, i); continue; }
    if (text[i] === '"') {
      i++; let closed = false;
      while (i < text.length) { if (text[i] === '\\') { i = Math.min(i + 2, text.length); continue; } if (text[i++] === '"') { closed = true; break; } }
      if (!closed) c.diagnostic('flick.string', 'Unclosed string.', start, i);
      if (Buffer.byteLength(text.slice(start + 1, i - 1)) > 255) c.diagnostic('flick.string.length', 'Payload exceeds the native 255-byte helper limit.', start, i, 'warning');
      push('string', start, i, 'STRING'); continue;
    }
    const phrase = /^else if\b/i.exec(text.slice(i));
    if (phrase) { i += phrase[0].length; push('keyword', start, i, 'else if'); continue; }
    const m = /^(?:-?0[xX][\da-fA-F]+|-?(?:(?:\d+\.\d*|\.\d+)(?:[eE][+-]?\d+)?|\d+[eE][+-]?\d+)|-?\d+|!?[A-Za-z_][A-Za-z0-9_]*|<<|>>|[^\s])/.exec(text.slice(i));
    const value = m[0]; i += value.length; const lower = value.toLowerCase();
    let id, type = 'operator';
    if (/^-?0x/i.test(value)) { id = 'HEX'; type = 'number'; }
    else if (/^-?\d+$/.test(value)) { id = 'INTEGER'; type = 'number'; }
    else if (/^-?(?:\d|\.\d)/.test(value)) { id = 'FLOAT'; type = 'number'; }
    else if (terminals.has(lower)) { id = lower; type = /^[A-Za-z_]/.test(value) ? 'keyword' : 'operator'; }
    else if (/^!?[A-Za-z_]/.test(value)) { id = 'IDENTIFIER'; type = 'identifier'; }
    else { c.diagnostic('editor.flick.character', `Unrecognized Flick character ${JSON.stringify(value)}. The native lexer discards it; it is not a supported operator.`, start, i, 'error'); }
    push(type, start, i, id);
  }
  const stringFailure = r.diagnostics.some(d => ['flick.string', 'flick.comment'].includes(d.code));
  const braceStack = [], extraBraces = new Set();
  if (!stringFailure) for (const t of tokens) {
    if (t.id === '{') braceStack.push(t);
    else if (t.id === '}') { if (braceStack.length) braceStack.pop(); else { extraBraces.add(t.start); c.diagnostic('flick.close', 'Unexpected closing brace.', t.start, t.end); } }
  }
  if (!stringFailure) for (const t of braceStack) c.diagnostic('flick.block.close', 'Missing } for this Flick block.', t.start, t.end);
  try {
    if (stringFailure) r.syntaxAccepted = false;
    else {
      const p = earley(tokens); r.syntaxAccepted = p.accepted;
      if (!p.accepted) {
        const t = tokens[p.farthest] || { value: 'end of file', start: text.length, end: text.length };
        if (!extraBraces.has(t.start) && !(p.farthest === tokens.length && braceStack.length)) c.diagnostic('flick.syntax', `Unexpected ${t.value}. Expected ${p.expected.join(', ')}.`, t.start, t.end);
      }
    }
  } catch (e) { if (e.message !== 'Flick analysis budget') throw e; c.diagnostic('analysis.budget', 'Flick grammar analysis budget reached; remaining syntax was not checked.', 0, 0, 'warning'); }
  const stack = [], names = new Set();
  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k], next = tokens[k + 1];
    if ((t.id === '[' && k === 0) || ['thread', 'bool', 'int', 'float', 'string', 'role', 'event', 'effect', 'point'].includes(t.id)) {
      if (next?.id === 'IDENTIFIER') {
        const kind = t.id === '[' ? 'block' : t.id === 'thread' ? 'function' : 'variable';
        const symbol = c.symbol(next.value, kind, next.start, next.end, t.id === '[' ? 'Flick sequence' : t.id);
        r.occurrences.push({ name: next.value, start: next.start, end: next.end, declaration: true, symbolStart: symbol.start }); names.add(next.start);
        if (options.profile === 'space-siege' && ['effect', 'point'].includes(t.id)) c.diagnostic('flick.profile', `${t.id} declarations are parsed but rejected by the Space Siege compiler.`, t.start, next.end);
      }
    }
    if (t.id === '{') stack.push(t.start);
    if (t.id === '}' && stack.length) r.folds.push({ start: stack.pop(), end: t.end });
  }
  for (const t of tokens) if (t.id === 'IDENTIFIER' && !names.has(t.start)) { const s = r.symbols.find(s => s.name === t.value); r.occurrences.push({ name: t.value, start: t.start, end: t.end, symbolStart: s?.start }); }
  return finish(c);
}
module.exports = { parseFlick, earley, terminals };
