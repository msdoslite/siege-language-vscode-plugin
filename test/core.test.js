'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { analyze, languageFor } = require('../src/core');
const { AnalyzerClient } = require('../src/analyzer-client');
const code = (r, prefix) => r.diagnostics.filter(d => d.code.startsWith(prefix));
const errors = r => r.diagnostics.filter(d => d.severity === 'error');
test('Skrit agrees with saved research grammar fixtures', async t => {
  const fixtures = require('./fixtures/skrit-research.json');
  for (const f of fixtures) await t.test(f.profile + ': ' + f.source.slice(0, 95), () => {
    const result = analyze(f.source, 'skrit', { profile: f.profile });
    assert.equal(Boolean(result.syntaxAccepted), f.accepted, JSON.stringify(result.diagnostics));
    if (f.profile === 'ds2') assert.equal(Boolean(analyze(f.source, 'skrit', { profile: 'space-siege' }).syntaxAccepted), f.accepted);
  });
});
test('Flick agrees with132-production research fixtures', async t => {
  for (const f of require('./fixtures/flick-research.json')) await t.test(f.source || '<empty>', () => assert.equal(Boolean(analyze(f.source, 'flick', { profile: 'ds2' }).syntaxAccepted), f.accepted));
});
test('GAS multiline, duplicate properties, prefixes, paths and braces', () => {
  const source = '[t:template,n:thing] { i count = 0x10; v scale = 2; child:path = hello; text = [[a; { } // raw\n b]]; }';
  const r = analyze(source, 'gas', { profile: 'dsloa' }); assert.deepEqual(errors(r), []); assert.equal(r.regions.length, 0); assert.equal(r.symbols[0].name, 'thing'); assert.equal(r.symbols[3].name, 'child:path');
  const d = analyze('[a]{x=1;X=2;}', 'gas', { duplicateProperties: 'warning' }); assert.equal(code(d, 'editor.gas.duplicate').length, 1); assert.equal(errors(d).length, 0);
  assert.equal(code(analyze('[a]{x=1;X=2;}', 'gas', { duplicateProperties: 'off' }), 'editor.gas.duplicate').length, 0);
});
test('GAS quotes have no escape protection; first bracket pair wins', () => {
  const r = analyze('[a]{ x="a\\"tail"; y=[[a]]tail; }', 'gas'); assert.equal(code(r, 'editor.gas.value.tail').length, 2);
  assert.equal(r.symbols.find(s => s.name === 'x').value, 'a\\');
});
test('GAS type validation distinguishes incomplete vectors and full scalar forms', () => {
  for (const [prefix, value, valid] of [['b', 'TRUE', true], ['b', '1', false], ['i', '123x', false], ['x', '10', true], ['v', '2', true], ['v', '1,2', false], ['q', '0,0,0,1', true], ['q', '1,2,3', false], ['p', '1,2,3,0x1234abcd', true]]) assert.equal(errors(analyze(`[a]{${prefix} x=${value};}`, 'gas')).length === 0, valid, prefix + value);
});
test('GAS repair ranges and profile selection', () => {
  assert.equal(code(analyze('[a]{x=1}', 'gas'), 'gas.semicolon').length, 1);
  assert.equal(code(analyze('[a]{x=1;', 'gas'), 'gas.block.close').length, 1);
  assert.equal(code(analyze('[a]{x@=1;}', 'gas', { profile: 'space-siege' }), 'gas.dialect').length, 0);
  assert.equal(code(analyze('[a]{x@=1;}', 'gas', { profile: 'dsloa' }), 'gas.dialect').length, 1);
});
test('Only known consumer contexts enable inline Skrit; diagnostics retain outer coordinates', () => {
  assert.equal(analyze('[a]{skrit=[[not code]];}', 'gas').regions.length, 0);
  const r = analyze('[world]{[global]{[formula]{[general_formulas]{skrit=[[\nvoid f$(){ break; }\n]];}}}}', 'gas');
  assert.equal(r.regions.length, 1); assert.equal(code(r, 'skrit.loop')[0].range.start.line, 1);
  assert.equal(analyze('[a]{x=[[int v$;]];}', 'gas', { inlineSkritPaths: ['a:x'] }).regions.length, 1);
});
test('Skrit semantic guards, parameters, shadowing and reference binding', () => {
  const text = 'int a$; float Add$(int a$, float b$){int x$=a$; if(true){int x$=2; x$=3;} return b$;}';
  const r = analyze(text, 'skrit'); assert.deepEqual(errors(r), []);
  assert.equal(r.symbols.find(s => s.name === 'Add$').parameters.length, 2);
  const xs = r.symbols.filter(s => s.name === 'x$'); assert.equal(xs.length, 2);
  const assignment = r.occurrences.find(o => o.start === text.indexOf('x$=3')); assert.equal(assignment.symbolStart, xs[1].start);
  assert.equal(code(analyze('void f$(){break;continue;return 1;}', 'skrit'), 'skrit.loop').length, 2);
  assert.equal(code(analyze('void f$(){return 1;}', 'skrit'), 'skrit.return').length, 1);
  assert.equal(code(analyze('int f$(){return;}', 'skrit'), 'skrit.return').length, 1);
  assert.equal(code(analyze('void f$(){int a$;int a$;}', 'skrit'), 'skrit.duplicate').length, 1);
  assert.equal(code(analyze('void f$(){while(true){break;}}', 'skrit'), 'skrit.loop').length, 0);
  assert.equal(code(analyze('void f(){}', 'skrit'), 'skrit.userid').length, 1);
});
test('Static nesting editor policy stays a warning', () => {
  const r = analyze('trigger f$(){void g$(){}}', 'skrit'); assert.equal(r.syntaxAccepted, true); assert.equal(code(r, 'editor.static.nested')[0].severity, 'warning');
  assert.equal(code(analyze('void f$(){void g$(){}}', 'skrit'), 'skrit.function.nested').length, 1);
  assert.equal(code(analyze('trigger f$(){void g$(){}}', 'skrit', { strictStaticNesting: false }), 'editor.static.nested').length, 0);
});
test('Preprocessor guards skipped bodies, literal closers, directives and conditions', () => {
  for (const source of ['#include "a.skrit"\nint a$;', '#only(false) [[this is not a valid declaration]]\nint a$;', '#only(game) [[string a$="] ]";]]', '#option +force_float_constants\nfloat a$=1;']) assert.deepEqual(errors(analyze(source, 'skrit')), [], source);
  assert.equal(analyze('#include "a.skrit"\n', 'skrit').links[0].target, 'a.skrit');
  assert.equal(code(analyze('#include "a.skrit"', 'skrit'), 'skrit.directive.newline').length, 1);
  assert.equal(code(analyze('#only(false) [["oops', 'skrit'), 'skrit.string').length, 1);
  assert.equal(code(analyze('void f$(){x$++;}', 'skrit'), 'skrit.operator').length, 1);
});
test('NNK differs from quote-aware CSV; ignored directives stay informational', () => {
  const r = analyze('TREE=A_KEY,path,"hello, world"\nCANIMCLASS=F,Human\n', 'nnk');
  assert.equal(code(r, 'nnk.csv').length, 1); assert.equal(code(r, 'nnk.ignored').length, 0); assert.ok(r.symbols.some(s => s.detail.includes('CANIMCLASS tool metadata')));
  assert.equal(code(analyze('TREE=Z,path,Desc\n', 'nnk'), 'nnk.prefix').length, 1);
});
test('Required and GPG comments have distinct behavior', () => {
  assert.equal(code(analyze('//abc\nA.dsres\n', 'required', { profile: 'dsloa' }), 'required.comment').length, 1);
  assert.equal(code(analyze('A.dsres\nB.dsres\n', 'required', { profile: 'dsloa' }), 'required.accumulation').length, 1);
  assert.equal(analyze('//abc\nA\n', 'gpg').links.length, 1);
  assert.equal(languageFor('/tmp/startup_verify.gpg'), 'gpg'); assert.equal(languageFor('/tmp/other.gpg'), null); assert.equal(languageFor('/tmp/$required'), 'required');
});
test('UTF16 offsets and line ranges preserve non-ASCII string content', () => {
  const text = '[a]{ s title="Привет 🎮";\n b value=invalid; }', r = analyze(text, 'gas'); const d = code(r, 'gas.type.b')[0];
  assert.equal(d.range.start.line, 1); assert.equal(text.slice(d.start, d.end), 'invalid');
});
test('Malformed input remains bounded and diagnostics are capped', () => {
  assert.equal(analyze('!'.repeat(1000), 'gas', { maxDiagnostics: 7 }).diagnostics.length, 7);
  let seed = 12345; const chars = 'abc$ {}[]();="\'\\/*+#-\n012';
  for (let k = 0; k < 100; k++) { let s = ''; for (let n = 0; n < 100; n++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; s += chars[seed % chars.length]; } for (const lang of ['gas', 'skrit', 'flick', 'nnk']) assert.doesNotThrow(() => analyze(s, lang, { maxDiagnostics: 20 })); }
});
test('Real worker performs isolated requests and disposes cleanly', async () => {
  const client = new AnalyzerClient();
  try { const [a, b] = await Promise.all([client.analyze('[a]{b enabled=true;}', 'gas', {}), client.analyze('void f$(){break;}', 'skrit', {})]); assert.deepEqual(a.result.diagnostics, []); assert.equal(code(b.result, 'skrit.loop').length, 1); assert.ok(!('tokens' in a.result)); } finally { client.dispose(); }
});

test('Configuration proxies are snapshotted before worker transfer', async () => {
  const client = new AnalyzerClient();
  try { const r = await client.analyze('int x$;', 'skrit', { conditions: new Proxy({ game: true }, {}), inlineSkritPaths: new Proxy([], {}) }); assert.deepEqual(r.result.diagnostics, []); } finally { client.dispose(); }
});

test('Known user function arity, event forms and macro literal token kinds', () => {
  assert.equal(code(analyze('int F$(int a$){return a$;} void Main$(){F$();}', 'skrit'), 'skrit.call.arity').length, 1);
  assert.equal(code(analyze('trigger Event$(int a$){}', 'skrit'), 'skrit.trigger.parameter').length, 1);
  assert.equal(code(analyze('event Event$(1){}', 'skrit'), 'skrit.event.parameter').length, 1);
  assert.deepEqual(errors(analyze('event Event$(int){}', 'skrit')), []);
  assert.equal(analyze('void f$(){int n$=__LINE__; string s$=__NAME__;}', 'skrit').syntaxAccepted, true);
  assert.equal(code(analyze('void f$(){1=2;}', 'skrit'), 'skrit.assignment').length, 1);
});

test('CRLF directives match without consuming CR as source syntax (FPSTest regression)', async t => {
  for (const profile of ['dsloa', 'ds2', 'space-siege']) await t.test(profile, () => {
    const source = '// header\r\n\r\n#include "LogOut.skrit"\r\n#option +force_float_constants\r\nproperty float TestLength$ = 30 doc = "Sample period, in seconds.";\r\n';
    const r = analyze(source, 'skrit', { profile });
    assert.deepEqual(errors(r), []);
    assert.equal(r.links.length, 1);
    assert.equal(r.links[0].target, 'LogOut.skrit');
    assert.equal(source.slice(r.links[0].start, r.links[0].end), 'LogOut.skrit');
    assert.equal(r.symbols.find(s => s.name === 'TestLength$').location.line, 4);
    const comment = analyze('#include "LogOut.skrit" // comment\r\n#option -explicit_states\r\n', 'skrit', { profile });
    assert.deepEqual(errors(comment), []);
    const eof = analyze('#include "LogOut.skrit"\r', 'skrit', { profile });
    assert.equal(code(eof, 'skrit.directive').filter(d => d.code === 'skrit.directive').length, 0);
    assert.equal(code(eof, 'skrit.directive.newline').length, 1);
  });
});

test('Case-insensitive Skrit keywords keep trigger returns out of function type checks', async t => {
  for (const profile of ['dsloa', 'ds2', 'space-siege']) await t.test(profile, () => {
    const source = 'State BuffParty$ { Trigger OnTimer$(1) { IF (true) { SetState SaveGame$; return; } } }\r\n';
    const r = analyze(source, 'skrit', { profile });
    assert.equal(r.syntaxAccepted, true); assert.deepEqual(errors(r), []);
    assert.equal(r.symbols.find(s => s.name === 'BuffParty$').kind, 'state');
    assert.equal(r.symbols.find(s => s.name === 'OnTimer$').kind, 'trigger');
    assert.equal(r.tokens.find(t => t.value === 'Trigger').type, 'keyword');
    assert.equal(code(analyze('INT F$(){ ReTuRn; }', 'skrit', { profile }), 'skrit.return').length, 1);
    assert.equal(code(analyze('VoId F$(){ ReTuRn 1; }', 'skrit', { profile }), 'skrit.return').length, 1);
    assert.deepEqual(errors(analyze('VOID F$(){ ReTuRn; }', 'skrit', { profile })), []);
    assert.equal(analyze('BOOL Enabled$ = TRUE;', 'skrit', { profile }).syntaxAccepted, true);
    const directive = analyze('#InClUdE "LogOut.skrit"\r\n#OpTiOn +FORCE_FLOAT_CONSTANTS\r\nFLOAT Value$=1;\r\n', 'skrit', { profile });
    assert.deepEqual(errors(directive), []); assert.equal(directive.links[0].target, 'LogOut.skrit');
    assert.equal(analyze('void f$(){string s$=__name__; int n$=__line__;}', 'skrit', { profile }).syntaxAccepted, true);
  });
});

test('Legal GAS lists, repeated handlers/categories and empty-first values are preserved', async t => {
  const samples = [
    ['*', '[game_timer]{*=15;*=30;*=45;}', ['15', '30', '45']],
    ['search_category', '[Indoor]{search_category="indoor";search_category="picture";}', ['indoor', 'picture']],
    ['onlbuttonup', '[button]{onlbuttonup=loadtexture(first);onlbuttonup=loadtexture(second);}', ['loadtexture(first)', 'loadtexture(second)']],
    ['slot_type', '[slot]{slot_type=;slot_type=spell;}', ['', 'spell']]
  ];
  for (const profile of ['dsloa', 'ds2', 'space-siege']) await t.test(profile, () => {
    for (const [key, text, values] of samples) {
      const r = analyze(text, 'gas', { profile });
      assert.deepEqual(r.diagnostics, []);
      assert.deepEqual(r.symbols.filter(s => s.kind === 'property' && s.name === key).map(s => s.value), values);
    }
    assert.deepEqual(analyze(samples[0][1], 'gas', { profile, duplicateProperties: 'warning' }).diagnostics, []);
    const warning = analyze(samples[1][1], 'gas', { profile, duplicateProperties: 'warning' }).diagnostics;
    assert.equal(warning.length, 1); assert.equal(warning[0].code, 'editor.gas.duplicate'); assert.equal(warning[0].severity, 'warning');
  });
});
test('GAS scalar float suffix is accepted without accepting arbitrary numeric tails', () => {
  for (const prefix of ['f', 'd']) for (const value of ['30.0f', '30.0F', '-.5f', '1e3f', '30']) assert.deepEqual(analyze(`[sound]{${prefix} sound_cache_time=${value};}`, 'gas').diagnostics, [], prefix + value);
  for (const value of ['30.0garbage', '30ff', '1e+f']) assert.equal(code(analyze(`[a]{f x=${value};}`, 'gas'), 'gas.type.f').length, 1);
});
test('GAS header parser respects the asymmetric native separator rules', () => {
  for (const header of ['t:window;n:rollover_console', 't:window,n:rollover_console', 't:window n:rollover_console', 'n:rollover_console,t:window']) {
    const r = analyze(`[${header}]{}`, 'gas'); assert.equal(errors(r).length, header.includes(';') || header.includes(' n:') ? 1 : 0); assert.equal(code(r, 'editor.gas.header.separator').length, header.includes(';') || header.includes(' n:') ? 1 : 0); assert.equal(r.symbols[0].blockName, 'rollover_console'); assert.equal(r.symbols[0].detail, 'type window');
  }
  assert.equal(code(analyze('[n:name;t:window]{}', 'gas'), 'gas.header.name').length, 1);
  const typed = analyze('[t:window]{}', 'gas'); assert.deepEqual(typed.diagnostics, []); assert.equal(typed.symbols[0].blockName, '');
  const repeated = analyze('[n:first,t:window,n:last]{}', 'gas'); assert.deepEqual(repeated.diagnostics, []); assert.equal(repeated.symbols[0].blockName, 'last');
});

test('Implicit-void handlers bind optional named parameters without scanning API arguments as declarations', async t => {
  const source = 'on_add_custom_damage$(Go /*owner$*/){ GoCloneReq cloneReq$=MakeGoCloneReq("manager"); }\r\non_custom_damage$(Go victim$, Go attacker$, Go weapon$, float /*damage_amount$*/){ Siegefx.SRunScript("cold", victim$.Goid, weapon$.Goid, "", attacker$.Goid, WE_UNKNOWN); return; }';
  for (const profile of ['dsloa', 'ds2', 'space-siege']) await t.test(profile, () => {
    const r = analyze(source, 'skrit', { profile }); assert.equal(r.syntaxAccepted, true); assert.deepEqual(r.diagnostics, []);
    const fn = r.symbols.find(s => s.name === 'on_custom_damage$'); assert.equal(fn.kind, 'function'); assert.equal(fn.type, 'void'); assert.equal(fn.parameters.length, 4); assert.deepEqual(fn.parameters[3], { type: 'float', name: '' });
    assert.deepEqual(r.symbols.filter(s => s.kind === 'parameter').map(s => s.name), ['victim$', 'attacker$', 'weapon$']);
    assert.ok(!r.symbols.some(s => ['Go', 'WE_UNKNOWN', 'damage_amount$'].includes(s.name)));
    const declared = r.symbols.find(s => s.name === 'victim$'); assert.equal(r.occurrences.filter(o => o.symbolStart === declared.start).length, 2);
    assert.equal(code(analyze('F$(float /*unused$*/){return 1;}', 'skrit', { profile }), 'skrit.return').length, 1);
    assert.equal(code(analyze('void F$(int x$,int x$){}', 'skrit', { profile }), 'skrit.duplicate').length, 1);
  });
});
test('Noncanonical tolerated header separator is a strict error with a precise comma fix', () => {
  const text = '[t:window;n:rollover_console]{}', r = analyze(text, 'gas'); assert.equal(r.diagnostics.length, 1);
  const d = r.diagnostics[0]; assert.equal(d.code, 'editor.gas.header.separator'); assert.equal(d.severity, 'error'); assert.equal(text.slice(d.start, d.end), ';');
  assert.deepEqual(analyze(text.slice(0, d.fix.start) + d.fix.text + text.slice(d.fix.end), 'gas').diagnostics, []);
});
test('Malformed header tail reports the original typo and preserves closing-brace structure', () => {
  const text = '[outer]{[anim_files]d\r\n{0000=at;0001=at-02;}}', r = analyze(text, 'gas');
  assert.equal(r.diagnostics.length, 1); const d = r.diagnostics[0]; assert.equal(d.code, 'editor.gas.header.tail'); assert.equal(text.slice(d.start, d.end), 'd');
  assert.ok(r.symbols.some(s => s.kind === 'block' && s.name === 'anim_files')); assert.equal(code(r, 'gas.close').length, 0);
  assert.deepEqual(analyze(text.slice(0, d.fix.start) + text.slice(d.fix.end), 'gas').diagnostics, []);
  const missing = analyze('[outer]{[missing]\n[valid]{x=1;}}', 'gas'); assert.equal(code(missing, 'gas.open').length, 1); assert.equal(code(missing, 'gas.close').length, 0);
});

test('Sole void parameter marker is an empty signature, not an unnamed argument', async t => {
  for (const profile of ['dsloa', 'ds2', 'space-siege']) await t.test(profile, () => {
    for (const parameter of ['', 'void', ' /*before*/ VoId /*after*/ ']) {
      const source = `void request_more_mana$(${parameter}){} void Main$(){request_more_mana$();}`;
      const r = analyze(source, 'skrit', { profile }); assert.equal(r.syntaxAccepted, true); assert.deepEqual(r.diagnostics, []);
      assert.deepEqual(r.symbols.find(s => s.name === 'request_more_mana$').parameters, []);
      assert.equal(r.symbols.find(s => s.name === 'request_more_mana$').signature, 'void request_more_mana$()');
    }
    const extra = analyze('void F$(void){} void Main$(){F$(1);}', 'skrit', { profile });
    assert.equal(code(extra, 'skrit.call.arity').length, 1);
    const unnamed = analyze('void F$(int){} void Main$(){F$();}', 'skrit', { profile });
    assert.equal(unnamed.symbols.find(s => s.name === 'F$').parameters.length, 1); assert.equal(code(unnamed, 'skrit.call.arity').length, 1);
    const named = analyze('void F$(int x$){} void Main$(){F$();}', 'skrit', { profile }); assert.equal(code(named, 'skrit.call.arity').length, 1);
  });
});
