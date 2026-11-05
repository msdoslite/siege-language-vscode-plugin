'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { analyze } = require('../src/core');
const errors = r => r.diagnostics.filter(d => d.severity === 'error');
test('Native compound bitwise operators have complete tokens in every game profile', async t => {
 for (const profile of ['dsloa', 'ds2', 'space-siege']) await t.test(profile, () => {
  const r = analyze('void F$(){int bits$=0;bits$ |= 1;bits$ &= 3;bits$ ^= 2;}', 'skrit', {profile});
  assert.equal(r.syntaxAccepted,true); assert.deepEqual(errors(r),[]);
  assert.deepEqual(r.tokens.filter(t=>['|=','&=','^='].includes(t.value)).map(t=>t.id),profile==='dsloa'?[293,295,294]:[294,296,295]);
  assert.equal(analyze('void F$(){int b$=0;b$ <<= 1;}', 'skrit', {profile}).syntaxAccepted,false);
 });
});
test('NNK keeps whitespace-empty fields but still models strtok comma collapse', () => {
 const root=analyze('TREE = K\t, \t\t, "Skrits"\r\n','nnk');assert.deepEqual(root.diagnostics,[]);assert.equal(root.symbols[0].name,'K');
 const collapsed=analyze('TREE = K,,"Skrits"\n','nnk');assert.ok(collapsed.diagnostics.some(d=>d.code==='nnk.fields'));
 const metadata=analyze('CANIMCLASS = FS0, "Unarmed"\n','nnk');assert.deepEqual(metadata.diagnostics,[]);assert.ok(metadata.symbols[0].detail.includes('tool metadata'));
});
test('Header recovery preserves the block while flagging a misplaced property', () => {
 const source='[template]{[aspect]\nmaterial = flesh;\n{[voice]{*=sound;}}}',r=analyze(source,'gas');
 assert.equal(r.diagnostics.length,1);const d=r.diagnostics[0];assert.equal(d.code,'editor.gas.header.tail');assert.equal(source.slice(d.start,d.end),'material = flesh;');assert.equal(d.fix,undefined);
 assert.ok(r.symbols.some(s=>s.name==='voice'&&s.kind==='block'));assert.ok(!r.symbols.some(s=>s.name==='material'));
});
test('Removing a header typo retains the following author comment', () => {
 const source='[effect_script*] - // author note\n{name=turncoat;}',r=analyze(source,'gas');
 assert.equal(r.diagnostics.length,1);const d=r.diagnostics[0];assert.equal(source.slice(d.start,d.end),'-');
 const fixed=source.slice(0,d.fix.start)+source.slice(d.fix.end);assert.ok(fixed.includes('// author note'));assert.deepEqual(analyze(fixed,'gas').diagnostics,[]);
});
test('A colon after a quoted value remains an error, not a permissive valid suffix', () => {
 const source='[component]{summonEffect="fire":\ninitialDelay=.1;min=2;}',r=analyze(source,'gas');
 assert.equal(r.diagnostics.length,1);assert.equal(r.diagnostics[0].code,'editor.gas.value.tail');assert.equal(r.diagnostics[0].severity,'error');assert.ok(!r.symbols.some(s=>s.name==='initialDelay'));
 const fixed=analyze(source.replace('"fire":','"fire";'),'gas');assert.deepEqual(fixed.diagnostics,[]);assert.ok(fixed.symbols.some(s=>s.name==='initialDelay'));
});
test('Real malformed conditions and a double-dollar identifier still fail', () => {
 for (const source of ['void F$(){if(true){}else(false){}}','void F$(){if(A()) || (B())){}}','void F$(){job$$.MarkForDeletion(true);}']) assert.ok(errors(analyze(source,'skrit')).length,source);
 assert.deepEqual(errors(analyze('void F$(){if(true){}else if(false){}}','skrit')),[]);
});
test('Extra and missing GAS braces remain errors even though some engine EOF paths tolerate them', () => {
 assert.ok(analyze('[a]{x=1;}}','gas').diagnostics.some(d=>d.code==='gas.close'));
 assert.ok(analyze('[a]{[b]{x=1;}','gas').diagnostics.some(d=>d.code==='gas.block.close'));
});
