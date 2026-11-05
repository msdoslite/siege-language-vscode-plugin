'use strict';
const { context, finish } = require('./util');
const profiles = Object.fromEntries(['dsloa', 'ds2', 'space-siege'].map(p => [p, require('../../data/skrit-' + p + '.json')]));
const keywordMaps = Object.fromEntries(Object.entries(profiles).map(([name, p]) => [name, Object.fromEntries(Object.entries(p.keywords).map(([word, id]) => [word.toLowerCase(), id]))]));
const operators = { '->': 292, '|=': 293, '^=': 294, '&=': 295, '<=': 282, '>=': 283, '==': 284, '~=': 285, '!=': 286, '|': 287, '^': 288, '&': 289, '||': 290, '&&': 291, '+=': 296, '-=': 297, '*=': 298, '/=': 299, '%=': 300, '**': 301, '**=': 302 };
const operatorList = Object.keys(operators).sort((a, b) => b.length - a.length);
// Match the token pattern of #only, including comments and optional LF after ).
function onlyDirective(text, start) {
  const prefix = /^#only\b/i.exec(text.slice(start)); if (!prefix) return null;
  let i = start + prefix[0].length;
  function trivia(allowLF) {
    while (i < text.length) {
      if (/[ \t\r\v\f]/.test(text[i])) { i++; continue; }
      if (text[i] === '\n') { if (!allowLF) return false; i++; continue; }
      if (text.startsWith('//', i)) { const end = text.indexOf('\n', i + 2); if (!allowLF) return false; i = end < 0 ? text.length : end + 1; continue; }
      if (text.startsWith('/*', i)) { const end = text.indexOf('*/', i + 2); if (end < 0 || (!allowLF && text.slice(i, end).includes('\n'))) return false; i = end + 2; continue; }
      break;
    }
    return true;
  }
  if (!trivia(false) || text[i++] !== '(' || !trivia(false)) return null;
  const value = /^(?:[A-Za-z_][A-Za-z0-9_]*|0[xX][0-9a-fA-F]+|[0-9]+)/.exec(text.slice(i));
  if (!value) return null; i += value[0].length;
  if (!trivia(false) || text[i++] !== ')' || !trivia(true) || !text.startsWith('[[', i)) return null;
  return { length: i + 2 - start, condition: value[0] };
}
function lexSkrit(c, profile) {
  const { text, options, result: r } = c, out = [], ids = profile.ids;
  let i = 0, forceFloat = false, only = null;
  const push = (type, start, end, id) => { const t = { type, start, end, id, value: text.slice(start, end) }; r.tokens.push(t); if (id !== undefined && (!only || only.enabled)) out.push(t); };
  while (i < text.length) {
    if (/\s/.test(text[i])) { i++; continue; }
    let start = i;
    if (text.startsWith('//', i)) { i = text.indexOf('\n', i); if (i < 0) i = text.length; push('comment', start, i); continue; }
    if (text.startsWith('/*', i)) { const end = text.indexOf('*/', i + 2); i = end < 0 ? text.length : end + 2; push('comment', start, i); if (end < 0) c.diagnostic('skrit.comment', 'Unclosed block comment.', start, i); continue; }
    if (text.startsWith(']]', i) && only) { only = null; i += 2; push('directive', start, i); continue; }
    if (text[i] === '#' && /^[ \t]*$/.test(text.slice(text.lastIndexOf('\n', i - 1) + 1, i))) {
      const onlyMatch = onlyDirective(text, i);
      if (onlyMatch) {
        if (only) { if (only.enabled) c.diagnostic('skrit.only.nested', '#only cannot be nested.', start, start + onlyMatch.length, 'warning'); }
        else {
          const cond = onlyMatch.condition, lower = cond.toLowerCase(), conditions = { game: true, editor: false, ...(profile.profile === 'ds2' ? { retail: true, dev: false } : {}), ...options.conditions };
          const normalized = Object.fromEntries(Object.entries(conditions).map(([k, v]) => [k.toLowerCase(), v]));
          const enabled = lower === 'true' || (lower !== 'false' && (/^[+-]?(?:0x[\da-f]+|\d+)$/i.test(cond) ? Number(cond) !== 0 : Boolean(normalized[lower])));
          only = { start, enabled };
        }
        i += onlyMatch.length; push('directive', start, i); continue;
      }
      let end = text.indexOf('\n', i); if (end < 0) end = text.length;
      // Exclude CR from CRLF for directive matching; retain original source offsets.
      const line = text.slice(i, end).replace(/\r$/, ''), inc = /^#include[ \t]+"([^"]*)"[ \t]*(?:\/\/.*|\/\*[\s\S]*?\*\/[ \t]*)?$/i.exec(line);
      const opt = /^#option[ \t]+([+-])(explicit_states|force_float_constants)[ \t]*(?:\/\/.*)?$/i.exec(line);
      if (!only || only.enabled) {
        if (inc) { const at = i + line.indexOf('"') + 1; r.links.push({ start: at, end: at + inc[1].length, target: inc[1], kind: 'include' }); }
        else if (opt) { if (opt[2].toLowerCase() === 'force_float_constants') forceFloat = opt[1] === '+'; }
        else c.diagnostic('skrit.directive', 'Expected #include "path", #option +/-name, or #only(condition) [[...]].', i, end);
        if (end === text.length && !line.includes('//')) c.diagnostic('skrit.directive.newline', 'This directive needs a terminating LF token.', end, end, 'error', { start: end, end, text: '\n' });
      }
      i = end; push('directive', start, i); continue;
    }
    const quote = text[i];
    if (quote === '"' || quote === "'") {
      i++; let decoded = 0, closed = false;
      while (i < text.length) {
        if (text[i] === quote) { i++; closed = true; break; }
        if (text[i] === '\\') { const esc = i++; if (text[i] === 'x') { const hex = /^[\da-f]{1,2}/i.exec(text.slice(i + 1)); if (hex) { c.diagnostic('skrit.escape.hex', 'Native hex escape handling has byte-consumption quirks; check the resulting literal.', esc, i + 1 + hex[0].length, 'warning'); i += hex[0].length; } } if (i < text.length) i++; }
        else i++;
        decoded++;
      }
      if (!closed) c.diagnostic('skrit.string', `Unclosed ${quote === '"' ? 'string' : 'character'} literal.`, start, i);
      if (quote === '"' && decoded > 512 && profile.profile === 'dsloa') c.diagnostic('skrit.string.length', 'A single literal over 512 decoded bytes can be corrupted by this engine profile.', start, i, 'warning');
      if (quote === "'" && decoded > 4) c.diagnostic('skrit.char.length', 'Character literals contain at most four bytes.', start, i);
      push(quote === '"' ? 'string' : 'number', start, i, quote === '"' ? ids.string : ids.integer); continue;
    }
    const identifier = /^[A-Za-z_][A-Za-z0-9_]*\$?/.exec(text.slice(i));
    if (identifier) {
      i += identifier[0].length; const value = identifier[0], lower = value.toLowerCase(), keyword = keywordMaps[profile.profile][lower];
      const id = lower === '__line__' ? ids.integer : lower === '__name__' ? ids.string : value.endsWith('$') ? ids.user : (lower === 'true' || lower === 'false') ? ids.bool : keyword === undefined ? ids.system : keyword;
      push(keyword !== undefined ? 'keyword' : 'identifier', start, i, id); continue;
    }
    const num = /^(?:0[xX][\da-fA-F]+|(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?)/.exec(text.slice(i));
    if (num) { const s = num[0]; i += s.length; push('number', start, i, forceFloat || (!/^0x/i.test(s) && /[.eE]/.test(s)) ? ids.float : ids.integer); continue; }
    if (profile.profile !== 'dsloa') { const en = /^:[A-Za-z_][A-Za-z0-9_]*:/.exec(text.slice(i)); if (en) { i += en[0].length; push('number', start, i, 324); continue; } }
    const op = operatorList.find(s => text.startsWith(s, i));
    if (op) { i += op.length; push('operator', start, i, operators[op] + (profile.profile === 'dsloa' ? 0 : 1)); continue; }
    if (text.startsWith('++', i) || text.startsWith('--', i)) { i += 2; c.diagnostic('skrit.operator', 'Increment and decrement operators are not supported.', start, i); continue; }
    if ('{}();,.?:+-*/%=!<>~'.includes(text[i])) { i++; push('operator', start, i, text.charCodeAt(start)); continue; }
    c.diagnostic('skrit.character', `Unexpected character ${JSON.stringify(text[i])}.`, i, i + 1); i++;
  }
  if (only) c.diagnostic('skrit.only.close', 'Unclosed #only body (strict editor rule).', only.start, text.length, 'warning');
  out.push({ id: 0, value: 'end of file', start: text.length, end: text.length });
  return out;
}
function lrParse(tokens, p) {
  const h = a => { const value = p.words[(a - p.base) / 2]; if (value === undefined) throw Error('Invalid LR table address'); return value; };
  const [rows, offsets, defaults, exceptions, lengths, gotos, gotoOffsets] = p.addresses;
  function advance(stack, id) {
    for (let steps = 0; steps < 2048; steps++) {
      const state = stack[stack.length - 1]; let rule;
      if (state >= p.threshold) rule = state - p.subtract;
      else {
        const base = rows + 2 * h(offsets + state * 2); let k = 0;
        if (h(base) >= 0) {
          while (id < h(base + 2 * k)) { if (++k > 1024) throw Error('Invalid terminal row'); }
          if (id === h(base + 2 * k)) { stack.push(-1 - h(base - 2 * (k + 1))); return 'shift'; }
        }
        if (state >= p.defaults) return 'error';
        rule = h(defaults + 2 * state);
        if (rule < 0) { let a = exceptions - 2 * (rule + 1), n = 0; while (h(a) >= 0 && h(a) !== id) { a += 4; if (++n > 1024) throw Error('Invalid exception row'); } rule = h(a + 2); }
      }
      if (p.actions[rule] === 'error') return 'error';
      if (p.actions[rule] === 'accept') return 'accept';
      const n = h(lengths + 2 * rule); if (n >= stack.length) throw Error('LR stack underflow');
      stack.length -= n;
      const base = gotos + 2 * h(gotoOffsets + rule * 2); let k = 1;
      while (stack[stack.length - 1] < h(base + 2 * k)) { if (++k > 1024) throw Error('Invalid goto row'); }
      const val = stack[stack.length - 1] === h(base + 2 * k) ? h(base - 2 * k) : h(base);
      stack.push(-1 - val);
    }
    throw Error('LR reduction budget exceeded');
  }
  const stack = [0];
  for (let i = 0; i < tokens.length; i++) {
    const before = stack.slice(), status = advance(stack, tokens[i].id);
    if (status === 'accept') return { accepted: true };
    if (status === 'error') {
      const candidates = [[59, ';'], [125, '}'], [41, ')'], [123, '{'], [p.ids.user, 'name$'], [p.ids.system, 'identifier'], [p.ids.integer, 'integer'], [p.ids.string, 'string'], ...Object.entries(p.keywords).map(([s, id]) => [id, s])];
      const expected = candidates.filter(([id]) => advance(before.slice(), id) !== 'error').map(([, s]) => s);
      return { accepted: false, token: tokens[i], expected: [...new Set(expected)].slice(0, 12) };
    }
  }
  return { accepted: false, token: tokens[tokens.length - 1], expected: [] };
}
const types = new Set(['bool', 'int', 'float', 'string', 'void']);
function semantic(c, ts) {
  const r = c.result, scopes = [{ start: 0, end: c.text.length, kind: 'global', parent: -1 }], stack = [0], pending = new Map(), decls = new Map();
  // Canonicalize keywords only: user identifiers and API spellings retain their source text.
  const t = i => ts[i]?.type === 'keyword' ? ts[i].value.toLowerCase() : ts[i]?.value;
  const symbolByStart = new Map();
  const current = () => stack[stack.length - 1];
  const scopeChain = id => { const a = []; for (let s = id; s >= 0; s = scopes[s].parent) a.push(s); return a; };
  function add(index, kind, type, scope = current(), extra = {}) {
    const tok = ts[index]; if (!tok) return;
    const key = scope + ':' + tok.value;
    if (['variable', 'parameter'].includes(kind) && ['variable', 'parameter'].includes(decls.get(key)?.kind)) c.diagnostic('skrit.duplicate', 'Duplicate declaration in the same scope.', tok.start, tok.end);
    const s = c.symbol(tok.value, kind, tok.start, tok.end, type, { type, scope, id: tok.start, ...extra });
    decls.set(key, s); symbolByStart.set(s.start, s); tok.declaration = true; tok.symbolStart = s.start;
    if (!tok.value.endsWith('$')) c.diagnostic('skrit.userid', 'User declarations require a trailing $.', tok.start, tok.end, 'error', { start: tok.end, end: tok.end, text: '$' });
    return s;
  }
  // Pair delimiters once. There is no recursive parsing of long expressions.
  const pairs = new Map(), brackets = [];
  for (let i = 0; i < ts.length; i++) {
    if (['(', '{'].includes(t(i))) brackets.push(i);
    else if ([')', '}'].includes(t(i))) { const j = brackets[brackets.length - 1]; if (j !== undefined && ((t(j) === '(' && t(i) === ')') || (t(j) === '{' && t(i) === '}'))) { brackets.pop(); pairs.set(j, i); pairs.set(i, j); } }
  }
  for (let i = 0; i < ts.length - 1; i++) {
    const tok = ts[i], value = t(i); tok.scope = current();
    if (tok.header) continue;
    if (value === '}') { if (stack.length > 1) { const s = scopes[stack.pop()]; s.end = tok.end; if (s.symbol) s.symbol.end = tok.end; r.folds.push({ start: s.start, end: tok.end }); } continue; }
    if (value === '{') {
      const p = pending.get(i) || { kind: 'block' }, id = scopes.length;
      scopes.push({ ...p, start: tok.start, end: c.text.length, parent: current() }); stack.push(id);
      if (p.parameters) for (const { index, type } of p.parameters) if (index !== null) add(index, 'parameter', type, id);
      continue;
    }
    const chain = scopeChain(current()), activeFn = chain.find(s => ['function', 'event'].includes(scopes[s].kind));
    if (value === '=' && ['number', 'string'].includes(ts[i - 1]?.type)) c.diagnostic('skrit.assignment', 'A literal cannot be an assignment target.', ts[i - 1].start, tok.end);
    if (value === 'doc') { let j = i - 1; while (j >= 0 && ![';', '{', '}'].includes(t(j))) j--; if (!ts.slice(j + 1, i).some(p => p.value === 'property')) c.diagnostic('skrit.doc', 'doc on a non-property declaration is ignored.', tok.start, tok.end, 'warning'); }
    if (value === 'break' || value === 'continue') { if (!chain.some(s => scopes[s].kind === 'loop')) c.diagnostic('skrit.loop', `${value} requires an enclosing loop.`, tok.start, tok.end); }
    if (value === 'return' && activeFn !== undefined) {
      const type = scopes[activeFn].type, empty = t(i + 1) === ';';
      if ((type === 'void' && !empty) || (type && type !== 'void' && empty)) c.diagnostic('skrit.return', type === 'void' ? 'Void functions cannot return a value.' : 'This function must return a value.', tok.start, ts[i + 1].end);
    }
    if (['while', 'forever', 'if', 'else'].includes(value)) { let b = i + 1; if (t(b) === '(') b = (pairs.get(b) ?? b) + 1; if (t(b) === '{') pending.set(b, { kind: value === 'while' || value === 'forever' ? 'loop' : 'block' }); }
    const declarationStart = i === 0 || [';', '{', '}', 'property', 'hidden', 'shared', 'my', 'gas', 'startup'].includes(t(i - 1));
    const implicitFunction = declarationStart && tok.type === 'identifier' && tok.value.endsWith('$') && ['(', '{', 'at'].includes(t(i + 1));
    if (['state', 'event', 'trigger'].includes(value) || implicitFunction || (declarationStart && (types.has(value) || tok.type === 'identifier') && ts[i + 1]?.type === 'identifier')) {
      const nameIndex = implicitFunction ? i : i + 1, name = ts[nameIndex]; if (!name || name.type !== 'identifier') continue;
      let after = nameIndex + 1, params = [];
      if (t(after) === '(') {
        const end = pairs.get(after); if (end === undefined) continue;
        // A parameter is a type with an optional name, not arbitrary neighboring
        // identifiers. Comments have already been removed by the lexer.
        const emptyVoid = end === after + 2 && t(after + 1) === 'void';
        let segmentStart = after + 1;
        for (let j = after + 1; !emptyVoid && j <= end; j++) {
          if (j < end && t(j) !== ',') continue;
          const length = j - segmentStart, first = ts[segmentStart];
          const isType = first && (types.has(t(segmentStart)) || (first.type === 'identifier' && !first.value.endsWith('$')));
          if (isType && length === 2 && ts[segmentStart + 1].type === 'identifier') params.push({ index: segmentStart + 1, type: t(segmentStart) });
          else if (isType && length === 1 && (value !== 'trigger' || types.has(t(segmentStart)))) params.push({ index: null, type: t(segmentStart) });
          segmentStart = j + 1;
        }
        if (value === 'trigger' && params.length) c.diagnostic('skrit.trigger.parameter', 'Static triggers require constant arguments, not typed parameters.', ts[after].start, ts[end].end);
        if (value === 'event' && ts.slice(after + 1, end).some(p => p.type === 'number' || p.type === 'string' || ['true', 'false'].includes(p.value.toLowerCase()))) c.diagnostic('skrit.event.parameter', 'Event handlers require typed parameters, not constants.', ts[after].start, ts[end].end);
        after = end + 1;
      }
      if (value === 'state' && t(after) === 'poll') { after++; if (t(after) === '(') after = (pairs.get(after) ?? after) + 1; }
      const block = t(after) === '{';
      if (block) {
        const kind = ['state', 'event', 'trigger'].includes(value) ? value : 'function', type = kind === 'event' || implicitFunction ? 'void' : value;
        if (kind === 'state' && chain.some(s => scopes[s].kind === 'state')) c.diagnostic('skrit.state.nested', 'Nested states are not supported.', tok.start, name.end);
        if (activeFn !== undefined && ['event', 'trigger', 'function'].includes(kind)) c.diagnostic('skrit.function.nested', 'Nested functions/events are not supported inside an active function.', tok.start, name.end);
        if (chain.some(s => scopes[s].kind === 'trigger') && c.options.strictStaticNesting !== false) c.diagnostic('editor.static.nested', 'Nested declarations in a static trigger can close its outer scope early (strict editor rule).', tok.start, name.end, 'warning');
        const sym = add(nameIndex, kind, type, current(), { parameters: params.map(p => ({ name: p.index === null ? '' : t(p.index), type: p.type })), signature: `${implicitFunction ? 'void' : value} ${name.value}(${params.map(p => p.type + (p.index === null ? '' : ' ' + t(p.index))).join(', ')})` });
        pending.set(after, { kind, type, symbol: sym, parameters: params });
        // Parameter tokens belong to the upcoming function scope, not declarations here.
        for (let j = nameIndex + 1; j < after; j++) ts[j].header = true;
      } else if (!implicitFunction && !name.header && !['state', 'event', 'trigger'].includes(value) && (t(after) === ';' || t(after) === '=' || t(after) === ',')) {
        add(nameIndex, 'variable', value);
        let nesting = 0;
        for (let j = after; j < ts.length && ![';', '{', '}'].includes(t(j)); j++) { if (t(j) === '(') nesting++; if (t(j) === ')') nesting--; if (t(j) === ',' && nesting === 0 && ts[j + 1]?.type === 'identifier') add(j + 1, 'variable', value); }
      }
    }
  }
  for (const tok of ts) {
    if (tok.type !== 'identifier') continue;
    let symbol;
    if (tok.symbolStart !== undefined) symbol = symbolByStart.get(tok.symbolStart);
    else for (const scope of scopeChain(tok.scope ?? 0)) { const s = decls.get(scope + ':' + tok.value); if (s && (s.kind !== 'variable' || s.start <= tok.start)) { symbol = s; break; } }
    r.occurrences.push({ name: tok.value, start: tok.start, end: tok.end, scope: tok.scope ?? 0, declaration: Boolean(tok.declaration), symbolStart: symbol?.start });
  }
  const bound = new Map(r.occurrences.map(o => [o.start, o]));
  for (let i = 0; i < ts.length; i++) {
    if (ts[i].type !== 'identifier' || t(i + 1) !== '(' || ts[i].declaration) continue;
    const s = symbolByStart.get(bound.get(ts[i].start)?.symbolStart), end = pairs.get(i + 1);
    if (!s?.parameters || s.kind !== 'function' || end === undefined) continue;
    let count = end === i + 2 ? 0 : 1;
    for (let j = i + 2; j < end; j++) { if (t(j) === '(') j = pairs.get(j) ?? j; else if (t(j) === ',') count++; }
    if (count !== s.parameters.length) c.diagnostic('skrit.call.arity', `${s.name} expects ${s.parameters.length} arguments, received ${count}.`, ts[i].start, ts[end].end);
  }
  r.scopes = scopes.map(s => ({ start: s.start, end: s.end, parent: s.parent, kind: s.kind }));
}
function parseSkrit(text, options = {}) {
  const c = context(text, options), p = profiles[options.profile] || profiles.dsloa;
  const tokens = lexSkrit(c, p);
  if (!c.result.diagnostics.some(d => d.severity === 'error')) {
    const parsed = lrParse(tokens, p);
    c.result.syntaxAccepted = parsed.accepted;
    if (!parsed.accepted) {
      const t = parsed.token, expected = parsed.expected, fix = expected.includes(';') ? { start: t.start, end: t.start, text: ';' } : undefined;
      c.diagnostic('skrit.syntax', `Unexpected ${t.value === 'end of file' ? t.value : JSON.stringify(t.value)}.${expected.length ? ' Expected ' + expected.join(', ') + '.' : ''}`, t.start, t.end, 'error', fix);
    }
  }
  semantic(c, tokens); return finish(c);
}
module.exports = { parseSkrit, lexSkrit, lrParse, profiles };
