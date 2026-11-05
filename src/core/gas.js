'use strict';
const { context, finish, nameChar, numeric } = require('./util');
function parseHeader(header) {
  let i = 0, name = '', type = '';
  const noncanonical = [];
  if (/^dev,/i.test(header)) i = 4;
  const readName = () => { const start = i; while (nameChar(header[i])) i++; return header.slice(start, i); };
  if (!/^[nt]:/i.test(header.slice(i))) { name = readName(); return { name, type, noncanonical, valid: i === header.length && name.length > 0 }; }
  while (i < header.length) {
    const field = header[i].toLowerCase();
    if (!['n', 't'].includes(field) || header[i + 1] !== ':') return { name, type, noncanonical, valid: false };
    i += 2; const value = readName();
    if (field === 'n') name = value; else type = value;
    if (i === header.length) return { name, type, noncanonical, valid: true };
    // Native state6 skips exactly one byte after type; state5 requires ,t: after name.
    if (field === 't') { if (header[i] !== ',') noncanonical.push(i); i++; if (!/^n:/i.test(header.slice(i))) return { name, type, noncanonical, valid: false }; }
    else { if (!/^,t:/i.test(header.slice(i))) return { name, type, noncanonical, valid: false }; i++; }
  }
  return { name, type, noncanonical, valid: false };
}
const floatSuffix = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?[fF]$/;
function parseGas(text, options = {}) {
  const c = context(text, options), r = c.result;
  let i = 0, misplacedTerminator = -1;
  const stack = [{ name: '', path: '', start: 0, seen: new Map(), symbol: null }];
  const token = (type, start, end) => r.tokens.push({ type, start, end, value: text.slice(start, end) });
  const ws = () => { while (i < text.length) {
    if (/\s/.test(text[i])) { i++; continue; }
    if (text.startsWith('//', i)) { const s = i; i = text.indexOf('\n', i); if (i < 0) i = text.length; token('comment', s, i); continue; }
    if (text.startsWith('/*', i)) { const s = i, end = text.indexOf('*/', i + 2); i = end < 0 ? text.length : end + 2; token('comment', s, i); if (end < 0) c.diagnostic('gas.comment', 'Unclosed block comment.', s, i); continue; }
    break;
  }};
  function typed(prefix, value, start, end) {
    if (!prefix || prefix === 's') return;
    const v = value.trim(), number = numeric.test(v);
    const fail = message => c.diagnostic('gas.type.' + prefix, message, start, end);
    if (prefix === 'b' && !/^(true|false)$/i.test(v)) fail('Expected true or false (whole value).');
    if ('ix'.includes(prefix) && !/^[+-]?(?:\d+|0x[\da-f]+)$/i.test(v)) fail('Expected a complete decimal or hexadecimal integer.');
    if ('fd'.includes(prefix) && !number && !floatSuffix.test(v)) fail('Expected a complete numeric value.');
    if ('vq'.includes(prefix)) {
      const parts = v.split(',').map(x => x.trim()), count = prefix === 'v' ? 3 : 4;
      if (!((prefix === 'v' && parts.length === 1) || parts.length === count) || !parts.every(x => numeric.test(x))) fail(`Expected ${prefix === 'v' ? 'one scalar or ' : ''}${count} numeric components separated by commas.`);
    }
    if (prefix === 'p') {
      const parts = v.split(',').map(x => x.trim());
      if (parts.length !== 4 || !parts.slice(0, 3).every(x => numeric.test(x)) || !/^(?:0x)?[\da-f]{8}(?:[\da-f]{8})?$/i.test(parts[3])) fail('Expected SiegePos: three numbers and a node GUID.');
    }
  }
  while (i < text.length) {
    ws(); if (i >= text.length) break;
    const start = i, current = stack[stack.length - 1];
    if (text[i] === '}') {
      i++; token('delimiter', start, i);
      if (i === misplacedTerminator) { token('delimiter', i, i + 1); i++; misplacedTerminator = -1; }
      if (stack.length === 1) c.diagnostic('gas.close', 'Unexpected closing brace.', start, i, 'error', { start, end: i, text: '' });
      else { const b = stack.pop(); b.symbol.end = i; r.folds.push({ start: b.start, end: i }); }
      continue;
    }
    if (text[i] === '[' && text[i + 1] !== '[') {
      const close = text.indexOf(']', i + 1);
      if (close < 0) { c.diagnostic('gas.header', 'Missing ] in block header.', i, text.length); break; }
      const rawHeader = text.slice(i + 1, close), header = rawHeader.trim(); token('header', i, close + 1); i = close + 1; ws();
      const { name, type, valid, noncanonical } = parseHeader(header);
      if (valid) for (const separator of noncanonical) {
        const at = start + 1 + rawHeader.indexOf(header) + separator;
        c.diagnostic('editor.gas.header.separator', 'The native parser skips this separator without validating it. Use a comma in a canonical GAS header.', at, at + 1, 'error', { start: at, end: at + 1, text: ',' });
      }
      if (!valid) c.diagnostic('gas.header.name', 'Expected a valid GAS block header.', start + 1, close);
      if (text[i] !== '{') {
        const tailStart = i; let opening = i;
        // Recover this block without swallowing a later header or parent brace.
        while (opening < text.length && !'{}['.includes(text[opening])) opening++;
        if (text[opening] === '{') {
          let tailEnd = opening;
          // A trailing line comment is not part of the typo or its removal fix.
          const comment = text.indexOf('//', tailStart);
          if (comment >= 0 && comment < opening) tailEnd = comment;
          while (tailEnd > tailStart && /\s/.test(text[tailEnd - 1])) tailEnd--;
          c.diagnostic('editor.gas.header.tail', 'Unexpected text after ]. The native reader skips it before {; remove it from the header.', tailStart, tailEnd, 'error', /[=;]/.test(text.slice(tailStart, tailEnd)) ? undefined : { start: tailStart, end: tailEnd, text: '' });
          i = opening;
        } else { c.diagnostic('gas.open', 'Expected { after the block header.', i, i + 1); continue; }
      }
      token('delimiter', i, ++i);
      const path = current.path ? current.path + ':' + name : name;
      const symbol = c.symbol(name || `[t:${type}]`, 'block', start + 1, close, type ? `type ${type}` : 'GAS block', { start, end: i, selectionStart: start + 1, selectionEnd: close, container: current.path, path, blockName: name });
      stack.push({ name, path, start, symbol, seen: new Map() });
      continue;
    }
    let prefix = '';
    if (/[bdfipqsvx]/.test(text[i] || '') && /[ \t]/.test(text[i + 1] || '') && nameChar(text[i + 2])) { prefix = text[i]; token('type', i, i + 1); i += 2; }
    const keyStart = i;
    while (nameChar(text[i])) i++;
    if (i === keyStart) { c.diagnostic('gas.character', `Unexpected character ${JSON.stringify(text[i])}.`, i, i + 1); i++; continue; }
    let key = text.slice(keyStart, i), keyEnd = i; token('property', keyStart, i); ws();
    while (text[i] === ':') { i++; ws(); const s = i; while (nameChar(text[i])) i++; if (s === i) break; key += ':' + text.slice(s, i); keyEnd = i; token('property', s, i); ws(); }
    const op = text.startsWith('@=', i) ? '@=' : text[i];
    if (op !== '=' && op !== '@=') { c.diagnostic('gas.equals', 'Expected = after the property name.', i, i + 1); while (i < text.length && !/[;\n}\[]/.test(text[i])) i++; if (text[i] === ';') i++; continue; }
    if (op === '@=' && options.profile !== 'space-siege') c.diagnostic('gas.dialect', '@= belongs to the Space Siege profile.', i, i + 2);
    i += op.length; while (i < text.length && /\s/.test(text[i])) i++;
    const outerStart = i; let valueStart = i, valueEnd, mode = 'raw', recoveredTerminator = false;
    if (text.startsWith('[[', i) || text[i] === '"') {
      mode = text[i] === '"' ? 'quoted' : 'bracket'; const delimiter = mode === 'quoted' ? '"' : ']]';
      i += mode === 'quoted' ? 1 : 2; valueStart = i; const end = text.indexOf(delimiter, i);
      if (end < 0) { c.diagnostic('gas.value.close', `Missing ${delimiter} closing value.`, outerStart, text.length, 'error', { start: text.length, end: text.length, text: delimiter + ';' }); valueEnd = i = text.length; }
      else { valueEnd = end; i = end + delimiter.length; }
      const closeEnd = i; let next = i;
      while (next < text.length && /\s/.test(text[next])) next++;
      const nextHeader = text[next] === '[' && !text.startsWith('[[', next);
      const nextAssignment = /^(?:[bdfipqsvx][ \t])?[A-Za-z0-9_*$.-]+(?:\s*:\s*[A-Za-z0-9_*$.-]+)*\s*@?=/.test(text.slice(next));
      if (nextHeader || nextAssignment) {
        c.diagnostic('gas.semicolon', 'Expected ; after the closing value delimiter.', closeEnd, closeEnd, 'error', { start: closeEnd, end: closeEnd, text: ';' });
        i = next; recoveredTerminator = true;
      } else {
        const tailStart = i; while (i < text.length && text[i] !== ';' && text[i] !== '}') i++;
        if (text.slice(tailStart, i).trim()) c.diagnostic('editor.gas.value.tail', 'Unexpected text after the closing value delimiter. The native reader discards it; a missing semicolon can swallow the next property.', tailStart, i, 'error');
      }

    } else { while (i < text.length && text[i] !== ';' && text[i] !== '}') i++; valueEnd = i; }
    const value = text.slice(valueStart, valueEnd); token('string', outerStart, i);
    const simpleName = key.split(':').pop(), duplicate = current.seen.get(key.toLowerCase());
    if (duplicate !== undefined && options.duplicateProperties === 'warning' && simpleName !== '*') c.diagnostic('editor.gas.duplicate', 'Repeated properties are allowed. Single-value getters select the first match; enumeration can use all entries (optional editor warning).', keyStart, keyEnd, 'warning');
    current.seen.set(key.toLowerCase(), keyStart);
    const sym = c.symbol(key, 'property', keyStart, keyEnd, (prefix ? prefix + ' ' : '') + value.trim().slice(0, 120), { container: current.path, type: prefix, value, valueStart, valueEnd, mode, selectionStart: keyStart, selectionEnd: keyEnd });
    typed(prefix, value, valueStart, valueEnd);
    // Only the known formula consumer is automatic. Other contexts require explicit configuration.
    if ([current.path, key].filter(Boolean).join(':').toLowerCase() === 'world:global:formula:general_formulas:skrit' || (options.inlineSkritPaths || []).some(p => [current.path, key].filter(Boolean).join(':').toLowerCase() === p.toLowerCase())) r.regions.push({ language: 'skrit', start: valueStart, end: valueEnd });
    r.occurrences.push({ name: key, start: keyStart, end: keyEnd, declaration: true, symbolStart: sym.start });
    if (mode === 'bracket') r.folds.push({ start: outerStart, end: i });
    if (recoveredTerminator) continue;
    if (text[i] === ';') token('delimiter', i, ++i);
    else if (text[i] === '}' && text[i + 1] === ';') {
      misplacedTerminator = i + 1;
      c.diagnostic('editor.gas.semicolon.position', 'The property semicolon belongs before the closing brace, not after it.', i, i + 2, 'error', { start: i, end: i + 2, text: ';}' });
    }
    else c.diagnostic('gas.semicolon', 'Expected ; after the property value.', i, i + 1, 'error', { start: i, end: i, text: ';' });
  }
  for (const b of stack.slice(1)) { b.symbol.end = text.length; c.diagnostic('gas.block.close', 'Missing } for this block.', b.start, b.start + 1, 'error', { start: text.length, end: text.length, text: '\n}' }); }
  return finish(c);
}
module.exports = { parseGas, parseHeader };
