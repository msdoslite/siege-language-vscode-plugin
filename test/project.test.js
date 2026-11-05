'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
const { Project } = require('../src/project');
function fakeVscode(folder, settings = {}) {
  const uri = file => ({ path: file, toString: () => 'file://' + file }), diagnostics = new Map(), log = [];
  class Range { constructor(a, b, c, d) { this.start = { line: a, character: b }; this.end = { line: c, character: d }; } }
  class Diagnostic { constructor(range, message, severity) { Object.assign(this, { range, message, severity }); } }
  const v = { Range, Diagnostic, DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2 },
    window: { createOutputChannel: () => ({ appendLine: s => log.push(s), dispose() {} }) },
    languages: { createLanguageStatusItem: () => ({ dispose() {} }), createDiagnosticCollection: () => ({ set: (u, ds) => diagnostics.set(u.toString(), ds), delete: u => diagnostics.delete(u.toString()), dispose() {} }) },
    CancellationTokenSource: class { constructor() { this.token = { isCancellationRequested: false }; } cancel() { this.token.isCancellationRequested = true; } dispose() {} },
    RelativePattern: class { constructor(base, pattern) { Object.assign(this, { base, pattern }); } },
    workspace: { textDocuments: [], workspaceFolders: [{ uri: uri(folder) }], getWorkspaceFolder: u => u.path.startsWith(folder + '/') ? { uri: uri(folder) } : undefined,
      getConfiguration: section => ({ get: (key, fallback) => section === 'siege' && key in settings ? settings[key] : fallback }),
      fs: { stat: async u => fs.stat(u.path), readFile: async u => fs.readFile(u.path) },
      findFiles: async () => (await fs.readdir(folder)).filter(n => /\.(gas|skrit|flick|nnk)$/i.test(n) || n === '$required').map(n => uri(path.join(folder, n))) }
  };
  return { v, uri, diagnostics, log };
}
async function idle(p) { const deadline = Date.now() + 5000; while (p.scanning || p.active || p.queue.size || p.timers.size) { if (Date.now() > deadline) throw Error('Project did not become idle'); await new Promise(r => setTimeout(r, 5)); } }
async function setup(t) { const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'siege-project-')); const f = fakeVscode(folder, { 'diagnostics.debounceMs': 50 }); const p = new Project(f.v, { subscriptions: [] }); t.after(async () => { p.dispose(); await fs.rm(folder, { recursive: true, force: true }); }); return { folder, p, ...f }; }
test('Closed files get errors at startup; disk fixes clear them; deletion removes index', async t => {
  const { folder, p, uri, diagnostics } = await setup(t), file = path.join(folder, 'bad.gas'), u = uri(file);
  await fs.writeFile(file, '[a]{ b x=oops; }'); await p.scan(); await idle(p);
  assert.equal(diagnostics.get(u.toString()).length, 1); assert.equal(p.results.size, 1);
  await fs.writeFile(file, '[a]{ b x=true; }'); p.enqueue(u); await idle(p);
  assert.equal(diagnostics.get(u.toString()).length, 0); assert.ok(p.names.has('x'));
  await fs.unlink(file); p.deleted(u); assert.equal(p.results.size, 0); assert.equal(p.names.size, 0); assert.equal(diagnostics.has(u.toString()), false);
});
test('Unsaved buffer wins over disk and live edit clears diagnostics', async t => {
  const { folder, p, uri, diagnostics, v } = await setup(t), file = path.join(folder, 'live.skrit'), u = uri(file);
  await fs.writeFile(file, 'void f$(){break;}'); let text = 'void f$(){return;}';
  const doc = { uri: u, languageId: 'siege-skrit', isClosed: false, version: 1, getText: () => text }; v.workspace.textDocuments.push(doc);
  await p.scan(); await idle(p); assert.equal(diagnostics.get(u.toString()).length, 0);
  text = 'void f$(){break;}'; doc.version++; p.edited(doc); await idle(p); assert.equal(diagnostics.get(u.toString()).length, 1);
  text = 'void f$(){return;}'; doc.version++; p.edited(doc); await idle(p); assert.equal(diagnostics.get(u.toString()).length, 0);
});
test('An obsolete worker response cannot resurrect fixed or deleted errors', async t => {
  const { folder, p, uri, diagnostics, v } = await setup(t), u = uri(path.join(folder, 'race.gas'));
  let text = '[a]{b enabled=bad;}'; const doc = { uri: u, languageId: 'siege-gas', isClosed: false, version: 1, getText: () => text }; v.workspace.textDocuments.push(doc);
  let release; const first = new Promise(resolve => { release = resolve; }), real = p.client.analyze.bind(p.client); let calls = 0;
  p.client.analyze = async (...args) => { const result = await real(...args); if (++calls === 1) await first; return result; };
  p.enqueue(u); while (calls < 1) await new Promise(r => setTimeout(r, 5));
  text = '[a]{b enabled=true;}'; doc.version++; p.enqueue(u, true);
  while (!diagnostics.has(u.toString())) await new Promise(r => setTimeout(r, 5));
  assert.equal(diagnostics.get(u.toString()).length, 0); release(); await idle(p); assert.equal(diagnostics.get(u.toString()).length, 0);
  p.remove(u); assert.equal(diagnostics.has(u.toString()), false);
});
test('Disabling diagnostics clears previously published errors', async t => {
  const { folder, p, uri, diagnostics } = await setup(t), u = uri(path.join(folder, 'x.gas'));
  await fs.writeFile(u.path, '[a]{b x=bad;}'); p.enqueue(u); await idle(p); assert.equal(diagnostics.get(u.toString()).length, 1);
  p.v.workspace.getConfiguration = () => ({ get: (k, fallback) => k === 'diagnostics.enable' ? false : fallback });
  await p.scan(); await idle(p); assert.deepEqual(diagnostics.get(u.toString()), []);
});
