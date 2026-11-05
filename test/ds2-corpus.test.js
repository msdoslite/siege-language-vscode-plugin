'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {analyze}=require('../src/core');
const errors=r=>r.diagnostics.filter(d=>d.severity==='error');
test('DS2 retail/dev defaults select exactly one fragmented function header',()=>{
 const source='#only(retail)\n[[\nvoid DebugOutput$(string /*message$*/) {\n]]\n#only(dev)\n[[\nvoid DebugOutput$(string message$) {\n]]\nreturn;\n}';
 const retail=analyze(source,'skrit',{profile:'ds2'});assert.deepEqual(retail.diagnostics,[]);assert.equal(retail.symbols.find(s=>s.name==='DebugOutput$').parameters[0].name,'');
 const dev=analyze(source,'skrit',{profile:'ds2',conditions:{retail:false,dev:true}});assert.deepEqual(dev.diagnostics,[]);assert.equal(dev.symbols.find(s=>s.name==='DebugOutput$').parameters[0].name,'message$');
});
test('Comments between #only condition and opener are trivia, not directives or bracket errors',()=>{
 for(const profile of ['dsloa','ds2','space-siege'])for(const gap of [' // report\r\n','/*block*/\n','/*block\nline*/\n']){
  const r=analyze('#only(game)'+gap+'[[void F$(){}]]','skrit',{profile});assert.deepEqual(r.diagnostics,[]);assert.ok(r.symbols.some(s=>s.name==='F$'));
 }
 assert.deepEqual(analyze('#only(dev) // skipped debug body\n[[unknown words]]\n','skrit',{profile:'ds2'}).diagnostics,[]);
 assert.ok(errors(analyze('#only(\ntrue) [[int x$;]]','skrit',{profile:'ds2'})).length);
 assert.ok(errors(analyze('#only(-1) [[int x$;]]','skrit',{profile:'ds2'})).length);
});
test('Flick reports all extra braces without repeating the generic LR error',()=>{
 const r=analyze('[Scene]{thread Main{Cmd;}}}}','flick',{profile:'ds2'});
 assert.equal(r.syntaxAccepted,false);assert.equal(r.diagnostics.filter(d=>d.code==='flick.close').length,2);assert.equal(r.diagnostics.filter(d=>d.code==='flick.syntax').length,0);
 const missing=analyze('[Scene]{thread Main{Cmd;}','flick',{profile:'ds2'});assert.equal(missing.diagnostics.filter(d=>d.code==='flick.block.close').length,1);
});
test('Unsupported Flick punctuation is strict error; !Identifier remains an identifier',()=>{
 const r=analyze('[Scene]{thread Main{Cmd @;}}','flick',{profile:'ds2'});assert.equal(r.diagnostics[0].code,'editor.flick.character');assert.equal(r.diagnostics[0].severity,'error');
 assert.deepEqual(analyze('[Scene]{thread Main{Cmd !Ready;}}','flick',{profile:'ds2'}).diagnostics,[]);
 const unclosed=analyze('[Scene]{thread Main{Cmd "bad;}}','flick',{profile:'ds2'});assert.deepEqual(unclosed.diagnostics.map(d=>d.code),['flick.string']);
});
test('A GAS value terminator misplaced after } is one error with a preserving fix',()=>{
 const source='[fx]{skrit=[[void F$(){}]]\n};',r=analyze(source,'gas',{profile:'ds2'});assert.equal(r.diagnostics.length,1);const d=r.diagnostics[0];assert.equal(d.code,'editor.gas.semicolon.position');
 const fixed=source.slice(0,d.fix.start)+d.fix.text+source.slice(d.fix.end);assert.deepEqual(analyze(fixed,'gas',{profile:'ds2'}).diagnostics,[]);
 assert.ok(analyze('[fx]{x=1;};','gas',{profile:'ds2'}).diagnostics.some(d=>d.code==='gas.character'));
});
test('Missing quoted-value semicolon recovers before the next property or block',()=>{
 for(const source of ['[a]{doc="text"\n[common]{name="Chest";}}','[a]{page_type="page_book"\npage_image=texture;}']){
  const r=analyze(source,'gas',{profile:'ds2'});assert.equal(r.diagnostics.length,1);const d=r.diagnostics[0];assert.equal(d.code,'gas.semicolon');assert.ok(!r.diagnostics.some(d=>d.code==='gas.close'));
  const fixed=source.slice(0,d.fix.start)+d.fix.text+source.slice(d.fix.end);assert.deepEqual(analyze(fixed,'gas',{profile:'ds2'}).diagnostics,[]);
 }
});

test('Compact workspace candidates retain resources and all diagnostics without map-ID inflation',()=>{
 const {summarize}=require('../src/index-summary');
 const full=analyze('[t:template,n:actor]{x=1;}[map]{[0x1234]{guid=1;guid=2;*=a;0=b;}[0x5678]{guid=3;}}','gas',{profile:'ds2'});
 const r=summarize(full,'gas');assert.deepEqual(r.diagnostics,full.diagnostics);assert.ok(r.symbols.some(s=>s.name==='actor'));assert.ok(r.symbols.some(s=>s.name==='map'));assert.equal(r.symbols.filter(s=>s.name==='guid').length,1);assert.ok(r.indexOmitted>=5);assert.ok(!r.symbols.some(s=>s.name==='0x1234'));assert.equal(full.symbols.filter(s=>s.name==='guid').length,3);
});
