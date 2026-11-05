'use strict';
const { context, finish } = require('./util');
function parseList(text, options = {}, language = 'required') {
  const c = context(text, options), r = c.result; let start = 0, nonempty = 0;
  for (const line of text.split('\n')) {
    const raw = line.replace(/\r$/, ''), trimmed = raw.trim(), offset = start + raw.indexOf(trimmed);
    if (language === 'nnk') {
      const comment = raw.search(/#|\/\//), code = comment < 0 ? raw : raw.slice(0, comment);
      if (comment >= 0) r.tokens.push({ type: 'comment', start: start + comment, end: start + raw.length, value: raw.slice(comment) });
      if (Buffer.byteLength(raw) > 255) c.diagnostic('nnk.line.length', 'The native NNK reader truncates lines after 255 bytes.', start, start + raw.length, 'warning');
      if (code.trim()) {
        const equal = code.indexOf('=');
        if (equal < 0) c.diagnostic('nnk.equals', 'Expected DIRECTIVE = fields.', offset, start + code.length);
        else {
          const directive = code.slice(0, equal).trim().replace(/^"|"$/g, '').toUpperCase(), fields = code.slice(equal + 1).split(',').filter(s => s.length > 0).map(s => s.trim().replace(/^"|"$/g, ''));
          r.tokens.push({ type: 'keyword', start: offset, end: start + equal, value: directive });
          if (directive === 'TREE') {
            const prefix = fields[0] || '', p = start + equal + 1 + code.slice(equal + 1).indexOf(prefix);
            if (!/^[ABKMST](?:_|$)/i.test(prefix)) c.diagnostic('nnk.prefix', 'Expected a TREE prefix rooted at A, B, K, M, S or T, followed by _ or end.', p, p + prefix.length);
            if (fields.length < 3) c.diagnostic('nnk.fields', 'TREE normally has prefix, directory and description (strict editor warning).', start + equal + 1, start + code.length, 'warning');
            if (/"[^"\n]*,[^"\n]*"/.test(code.slice(equal + 1))) c.diagnostic('nnk.csv', 'Quotes do not protect commas in the native NNK reader.', start + equal + 1, start + code.length, 'warning');
            c.symbol(prefix, 'key', p, p + prefix.length, fields.slice(1).join(' — '));
          } else if (directive === 'CANIMCLASS') {
            // Known tool metadata is not a problem merely because this runtime reader ignores it.
            const key = fields[0] || '', at = start + equal + 1 + code.slice(equal + 1).indexOf(key);
            if (key) c.symbol(key, 'key', at, at + key.length, 'CANIMCLASS tool metadata; ignored by examined runtime NNK readers');
          }
          else c.diagnostic('nnk.unknown', 'This directive is ignored by the examined NNK reader.', offset, start + equal, 'information');
        }
      }
    } else if (trimmed) {
      if (trimmed.startsWith('//') && language === 'gpg') r.tokens.push({ type: 'comment', start: offset, end: start + raw.length, value: trimmed });
      else {
        nonempty++;
        if (language === 'required' && trimmed.startsWith('//')) c.diagnostic('required.comment', '// is normalized into a dependency path, not skipped as a comment.', offset, start + raw.length, 'warning');
        const path = trimmed.replace(/"/g, ''); r.links.push({ start: offset, end: offset + trimmed.length, target: path, kind: 'resource' });
        c.symbol(path, 'file', offset, offset + trimmed.length, language === 'required' ? 'Tank dependency' : 'Startup resource');
      }
    }
    start += line.length + 1;
  }
  if (language === 'required' && options.profile === 'dsloa' && nonempty > 1) c.diagnostic('required.accumulation', 'DSLOA appends subsequent lines to the previous normalized dependency; multiline lists may behave unexpectedly.', 0, text.indexOf('\n') < 0 ? text.length : text.indexOf('\n'), 'warning');
  return finish(c);
}
module.exports = { parseList };
