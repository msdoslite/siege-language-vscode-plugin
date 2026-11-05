'use strict';
const fs = require('node:fs'), path = require('node:path'), root = path.join(__dirname, '..');
function write(file, data) { fs.writeFileSync(path.join(root, file), JSON.stringify(data, null, 2) + '\n'); }
const common = [{ name: 'comment.line.double-slash', begin: '//', end: '$' }, { name: 'comment.block', begin: '/\\*', end: '\\*/' }];
const keywords = [...new Set(['dsloa', 'ds2', 'space-siege'].flatMap(p => Object.keys(require('../data/skrit-' + p + '.json').keywords)))];
write('syntaxes/skrit.tmLanguage.json', { name: 'Siege Skrit', scopeName: 'source.siege-skrit', patterns: [
 ...common, { name: 'meta.preprocessor.skrit', begin: '^[ \\t]*#(?i:include|option|only)\\b', end: '$', patterns: [{ name: 'string.quoted.double', begin: '"', end: '"' }, { name: 'keyword.control.directive', match: '#\\w+' }] },
 { name: 'string.quoted.double.skrit', begin: '"', end: '"', patterns: [{ name: 'constant.character.escape.skrit', match: '\\\\(?:x[0-9A-Fa-f]{1,2}|.)' }] },
 { name: 'string.quoted.single.skrit', begin: "'", end: "'", patterns: [{ name: 'constant.character.escape.skrit', match: '\\\\.' }] },
 { name: 'storage.type.skrit', match: '\\b(?i:bool|int|float|string|void)\\b' },
 { name: 'keyword.control.skrit', match: '\\b(?i:' + keywords.filter(k => !['bool', 'int', 'float', 'string', 'void', 'true', 'false', 'null'].includes(k)).join('|') + ')\\b' },
 { name: 'constant.language.skrit', match: '\\b(?i:true|false|null)\\b' },
 { name: 'entity.name.function.skrit', match: '[A-Za-z_][A-Za-z0-9_]*\\$?(?=\\s*\\()' },
 { name: 'variable.other.skrit', match: '[A-Za-z_][A-Za-z0-9_]*\\$' },
 { name: 'constant.numeric.skrit', match: '\\b0[xX][0-9a-fA-F]+\\b|(?:\\b[0-9]+(?:\\.[0-9]*)?|\\.[0-9]+)(?:[eE][+-]?[0-9]+)?' },
 { name: 'keyword.operator.skrit', match: '\\*\\*=|\\*\\*|->|[+*/%<>=!~&|^?:-]+' }
] });
write('syntaxes/gas.tmLanguage.json', { name: 'Siege GAS', scopeName: 'source.siege-gas', patterns: [ ...common,
 { name: 'meta.block.header.gas', begin: '\\[(?!\\[)', end: '\\]', patterns: [{ name: 'keyword.other.gas', match: '\\b(?:t|n):|\\bdev(?=,)' }, { name: 'entity.name.type.gas', match: '[A-Za-z0-9_*$.-]+' }] },
 { name: 'meta.property.gas', begin: '(?:([bdfipqsvx])([ \\t]))?([A-Za-z0-9_*$.-]+(?:\\s*:\\s*[A-Za-z0-9_*$.-]+)*)\\s*(@?=)', beginCaptures: { 1: { name: 'storage.type.gas' }, 3: { name: 'variable.other.property.gas' }, 4: { name: 'keyword.operator.assignment.gas' } }, end: ';|(?=})', patterns: [
 { name: 'string.quoted.other.multiline.gas', begin: '\\[\\[', end: '\\]\\]' },
 { name: 'string.quoted.double.gas', begin: '"', end: '"' },
 { name: 'constant.language.gas', match: '\\b(?i:true|false)\\b' },
 { name: 'constant.numeric.gas', match: '(?<![A-Za-z_])[-+]?(?:0[xX][0-9a-fA-F]+|(?:[0-9]+(?:\\.[0-9]*)?|\\.[0-9]+)(?:[eE][+-]?[0-9]+)?[fF]?)' }
 ] }
] });
write('syntaxes/flick.tmLanguage.json', { name: 'Siege Flick', scopeName: 'source.siege-flick', patterns: [ ...common,
 { name: 'string.quoted.double.flick', begin: '"', end: '"', patterns: [{ name: 'constant.character.escape.flick', match: '\\\\.' }] },
 { name: 'keyword.control.flick', match: '\\b(?i:entry|thread|role|required|external|critical|bool|int|float|string|event|effect|point|if|else|then|and|or|goto|run|branch|jump|wait|duration|until|_persist)\\b' },
 { name: 'entity.name.label.flick', begin: '<<', end: '>>' },
 { name: 'constant.numeric.flick', match: '-?(?:0[xX][0-9a-fA-F]+|[0-9]+(?:\\.[0-9]*)?(?:[eE][+-]?[0-9]+)?|\\.[0-9]+)' }
] });
write('syntaxes/nnk.tmLanguage.json', { name: 'Siege Naming Key', scopeName: 'source.siege-nnk', patterns: [
 { name: 'comment.line.nnk', match: '(?:#|//).*$' }, { name: 'keyword.other.nnk', match: '^\\s*(?i:TREE|CANIMCLASS)(?=\\s*=)' }, { name: 'constant.other.nnk', match: '\\b[ABKMST](?:_[A-Za-z0-9_]+)?\\b' }, { name: 'punctuation.separator.nnk', match: '[=,]' }
] });
write('syntaxes/required.tmLanguage.json', { name: 'Siege dependencies', scopeName: 'source.siege-required', patterns: [{ name: 'string.unquoted.path.siege', match: '.+' }] });
write('syntaxes/gpg.tmLanguage.json', { name: 'Siege startup manifest', scopeName: 'source.siege-gpg', patterns: [{ name: 'comment.line.double-slash', match: '^\\s*//.*$' }, { name: 'string.unquoted.path.siege', match: '.+' }] });
for (const language of ['gas', 'skrit', 'flick']) write('syntaxes/' + language + '-configuration.json', {
 comments: { lineComment: '//', blockComment: ['/*', '*/'] }, brackets: [['{', '}'], ['(', ')'], ['[', ']']],
 autoClosingPairs: [{ open: '{', close: '}' }, { open: '(', close: ')' }, { open: '[', close: ']' }, { open: '"', close: '"', notIn: ['string', 'comment'] }],
 surroundingPairs: [['{', '}'], ['(', ')'], ['[', ']'], ['"', '"']], wordPattern: language === 'gas' ? '[A-Za-z0-9_*$.-]+' : '[A-Za-z_][A-Za-z0-9_]*\\$?',
 indentationRules: { increaseIndentPattern: '^.*\\{[^}]*$', decreaseIndentPattern: '^\\s*\\}' }
});
write('syntaxes/nnk-configuration.json', { comments: { lineComment: '#' }, wordPattern: '[A-Za-z_][A-Za-z0-9_]*' });
write('snippets/gas.json', {
 'Named block': { prefix: 'block', body: ['[${1:name}]', '{', '\t$0', '}'], description: 'GAS named block' },
 'Typed template': { prefix: 'template', body: ['[t:template,n:${1:name}]', '{', '\t$0', '}'], description: 'GAS template block' },
 'Bracket value': { prefix: 'multiline', body: ['${1:name} = [[', '\t$0', ']];'], description: 'GAS bracket string (no implicit language)' },
 'Boolean': { prefix: 'bool', body: 'b ${1:name} = ${2|true,false|};' },
 'Vector': { prefix: 'vector', body: 'v ${1:name} = ${2:0}, ${3:0}, ${4:0};' }
});
write('snippets/skrit.json', {
 'Function': { prefix: 'function', body: ['${1:void} ${2:name}\\$(${3})', '{', '\t$0', '}'], description: 'Skrit function' },
 'Property': { prefix: 'property', body: 'property ${1:int} ${2:name}\\$ = ${3:0} doc = "${4:Description}";' },
 'State': { prefix: 'state', body: ['state ${1:Idle}\\$', '{', '\t$0', '}'] },
 'While': { prefix: 'while', body: ['while (${1:true})', '{', '\t$0', '}'] },
 'If': { prefix: 'if', body: ['if (${1:true})', '{', '\t$0', '}'] },
 'Include': { prefix: '#include', body: '#include "${1:path.skrit}"' },
 'Only': { prefix: '#only', body: ['#only(${1:game}) [[', '$0', ']]'] }
});
write('snippets/flick.json', { 'Scene': { prefix: 'scene', body: ['[${1:Scene}]', '{', '\tentry ${2:Main};', '\tthread ${2:Main}', '\t{', '\t\t$0', '\t}', '}'] } });
console.log('Generated fresh syntax grammars, configurations and snippets');
