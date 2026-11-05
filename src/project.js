'use strict';
const { AnalyzerClient } = require('./analyzer-client');
const { languageFor } = require('./core');
const GLOB = '**/{*.gas,*.GAS,*.skrit,*.SKRIT,*.flick,*.FLICK,*.nnk,*.NNK,$required,startup_verify.gpg}';
const EXCLUDE = '**/{.git,node_modules,.venv,.vscode-test}/**';
const LANGUAGE_IDS = { 'siege-gas': 'gas', 'siege-skrit': 'skrit', 'siege-flick': 'flick', 'siege-nnk': 'nnk', 'siege-required': 'required', 'siege-gpg': 'gpg' };
class Project {
  constructor(vscode, context) {
    this.v = vscode; this.context = context; this.client = new AnalyzerClient();
    this.results = new Map(); this.names = new Map(); this.epochs = new Map(); this.queue = new Map(); this.timers = new Map(); this.details = new Map(); this.active = 0; this.generation = 0; this.skipped = 0; this.disposed = false; this.scanning = false;
    this.output = vscode.window.createOutputChannel('Siege Language Tools');
    this.collection = vscode.languages.createDiagnosticCollection('siege');
    this.status = vscode.languages.createLanguageStatusItem('siege.index', Object.keys(LANGUAGE_IDS).map(language => ({ language })));
    this.status.name = 'Siege project analysis'; this.status.command = { title: 'Show analysis log', command: 'siege.showOutput' };
    context.subscriptions.push(this.output, this.collection, this.status, { dispose: () => this.dispose() });
  }
  language(doc) { return LANGUAGE_IDS[doc.languageId] || languageFor(doc.uri.path); }
  options(uri) {
    const c = this.v.workspace.getConfiguration('siege', uri);
    return { profile: c.get('profile', 'dsloa'), duplicateProperties: c.get('diagnostics.duplicateProperties', 'off'), strictStaticNesting: c.get('diagnostics.strictStaticNesting', true), inlineSkritPaths: c.get('inlineSkritPaths', []), conditions: c.get('conditions', {}), maxDiagnostics: c.get('diagnostics.maxPerFile', 200) };
  }
  document(uri) { const key = uri.toString(); return this.v.workspace.textDocuments.find(d => d.uri.toString() === key && !d.isClosed); }
  bump(uri) { const key = uri.toString(), n = (this.epochs.get(key) || 0) + 1; this.epochs.set(key, n); this.details.delete(key); return n; }
  enqueue(uri, priority = false) {
    if (this.disposed) return;
    const key = uri.toString(), epoch = this.bump(uri);
    this.queue.delete(key);
    if (priority) this.queue = new Map([[key, { uri, epoch }], ...this.queue]); else this.queue.set(key, { uri, epoch });
    this.pump();
  }
  edited(doc) {
    if (!this.language(doc)) return;
    const key = doc.uri.toString(); this.bump(doc.uri); this.queue.delete(key);
    clearTimeout(this.timers.get(key));
    const delay = this.v.workspace.getConfiguration('siege', doc.uri).get('diagnostics.debounceMs', 250);
    this.timers.set(key, setTimeout(() => { this.timers.delete(key); this.enqueue(doc.uri, true); }, delay));
  }
  pump() {
    while (!this.disposed && this.active < 2 && this.queue.size) {
      const [key, job] = this.queue.entries().next().value; this.queue.delete(key); this.active++;
      this.run(job).catch(e => { if (!this.disposed && this.epochs.get(key) === job.epoch) this.skip(job.uri, `analysis failed: ${e.message}`); }).finally(() => { this.active--; if (!this.disposed) { this.updateStatus(); this.pump(); } });
    }
    this.updateStatus();
  }
  async run({ uri, epoch }) {
    const key = uri.toString(), current = () => !this.disposed && this.epochs.get(key) === epoch;
    const doc = this.document(uri), language = doc ? this.language(doc) : languageFor(uri.path);
    if (!language || !current()) return;
    const max = this.v.workspace.getConfiguration('siege', uri).get('maxFileSizeKB', 4096) * 1024;
    let text;
    if (doc) text = doc.getText();
    else {
      try { const stat = await this.v.workspace.fs.stat(uri); if (!current()) return; if (stat.size > max) { this.skip(uri, `file exceeds ${max / 1024} KB`); return; } const bytes = await this.v.workspace.fs.readFile(uri); text = this.decode(bytes, uri); }
      catch (e) { if (current()) this.remove(uri); if (e.code !== 'FileNotFound' && e.code !== 'ENOENT') throw e; return; }
    }
    if (!current()) return;
    if (Buffer.byteLength(text) > max) { this.skip(uri, `file exceeds ${max / 1024} KB`); return; }
    const response = await this.client.analyze(text, language, this.options(uri), false);
    if (current()) this.publish(uri, language, response.result);
  }
  decode(bytes, uri) {
    const b = Buffer.from(bytes);
    if (b[0] === 0xff && b[1] === 0xfe) return b.subarray(2).toString('utf16le');
    const encoding = this.v.workspace.getConfiguration('siege', uri).get('encoding', 'utf-8');
    return new TextDecoder(encoding).decode(b);
  }
  skip(uri, reason) { this.skipped++; this.remove(uri); this.output.appendLine(`Skipped ${uri.toString()}: ${reason}.${reason.startsWith('file exceeds') ? ' Change siege.maxFileSizeKB to include it.' : ''}`); }
  publish(uri, language, result) {
    const key = uri.toString(); this.removeIndex(key);
    this.results.set(key, { uri, language, ...result });
    for (const symbol of result.symbols) { if (!this.names.has(symbol.name)) this.names.set(symbol.name, []); this.names.get(symbol.name).push({ uri: key, language, symbol }); }
    const enabled = this.v.workspace.getConfiguration('siege', uri).get('diagnostics.enable', true);
    const severities = { error: this.v.DiagnosticSeverity.Error, warning: this.v.DiagnosticSeverity.Warning, information: this.v.DiagnosticSeverity.Information };
    this.collection.set(uri, enabled ? result.diagnostics.map(d => { const item = new this.v.Diagnostic(new this.v.Range(d.range.start.line, d.range.start.character, d.range.end.line, d.range.end.character), d.message, severities[d.severity]); item.code = d.code; item.source = d.code.startsWith('editor.') ? 'Siege editor policy' : 'Siege'; return item; }) : []);
  }
  removeIndex(key) {
    const previous = this.results.get(key); if (!previous) return;
    for (const s of previous.symbols) { const matches = this.names.get(s.name)?.filter(r => r.uri !== key) || []; if (matches.length) this.names.set(s.name, matches); else this.names.delete(s.name); }
    this.results.delete(key);
  }
  remove(uri) { const key = uri.toString(); this.bump(uri); this.queue.delete(key); clearTimeout(this.timers.get(key)); this.timers.delete(key); this.removeIndex(key); this.collection.delete(uri); }
  deleted(uri) { const key = uri.toString(); this.remove(uri); for (const result of [...this.results.values()]) if (result.uri.toString().startsWith(key + '/')) this.remove(result.uri); }
  async detail(doc) {
    const language = this.language(doc); if (!language || this.disposed) return null;
    const key = doc.uri.toString(), version = doc.version, generation = this.generation;
    let cached = this.details.get(key); if (cached?.version === version && cached.generation === generation) return cached.promise;
    const text = doc.getText(), max = this.v.workspace.getConfiguration('siege', doc.uri).get('maxFileSizeKB', 4096) * 1024;
    if (Buffer.byteLength(text) > max) return null;
    const promise = this.client.analyze(text, language, this.options(doc.uri), true).then(({ result }) => !this.disposed && doc.version === version && this.generation === generation ? result : null).catch(e => { if (!this.disposed) this.output.appendLine(e.message); return null; });
    this.details.set(key, { version, generation, promise, estimatedBytes: text.length * 24 });
    let estimate = [...this.details.values()].reduce((n, item) => n + item.estimatedBytes, 0);
    while (this.details.size > 16 || (this.details.size > 1 && estimate > 32 * 1024 * 1024)) { const oldest = this.details.keys().next().value; estimate -= this.details.get(oldest).estimatedBytes; this.details.delete(oldest); }
    return promise;
  }
  excludeFor(uri) {
    const custom = this.v.workspace.getConfiguration('siege', uri).get('exclude', []);
    const search = this.v.workspace.getConfiguration('search', uri).get('exclude', {}), files = this.v.workspace.getConfiguration('files', uri).get('exclude', {});
    const exclusions = [EXCLUDE, ...custom, ...Object.entries({ ...files, ...search }).filter(([, enabled]) => enabled === true).map(([glob]) => glob)];
    return exclusions.length === 1 ? exclusions[0] : '{' + exclusions.join(',') + '}';
  }
  async diskChanged(uri) {
    if (this.disposed) return;
    if (this.document(uri)) return;
    const folder = this.v.workspace.getWorkspaceFolder(uri);
    if (!folder || !this.v.workspace.getConfiguration('siege', uri).get('indexWorkspace', true)) return;
    const generation = this.generation;
    const relative = uri.path.slice(folder.uri.path.length + 1);
    const found = await this.v.workspace.findFiles(new this.v.RelativePattern(folder, relative), this.excludeFor(uri), 1);
    if (this.disposed || generation !== this.generation) return;
    if (found.length) this.enqueue(uri); else this.remove(uri);
  }
  async scan() {
    if (this.disposed) return;
    this.discovery?.cancel(); const cancel = this.discovery = new this.v.CancellationTokenSource();
    this.generation++; this.skipped = 0; this.scanning = true; this.queue.clear(); this.details.clear();
    for (const key of this.epochs.keys()) this.epochs.set(key, this.epochs.get(key) + 1);
    const folders = this.v.workspace.workspaceFolders || [];
    for (const { uri } of this.results.values()) if (!this.v.workspace.getWorkspaceFolder(uri) && !this.document(uri)) this.remove(uri);
    for (const doc of this.v.workspace.textDocuments) if (this.language(doc)) this.enqueue(doc.uri, true);
    const found = new Set();
    try {
      for (const folder of folders) {
        const config = this.v.workspace.getConfiguration('siege', folder.uri);
        if (!config.get('indexWorkspace', true)) continue;
        const exclude = this.excludeFor(folder.uri);
        const uris = await this.v.workspace.findFiles(new this.v.RelativePattern(folder, GLOB), exclude, undefined, cancel.token);
        if (cancel.token.isCancellationRequested || this.disposed) return;
        for (const uri of uris) { found.add(uri.toString()); if (!this.document(uri)) this.enqueue(uri); }
      }
      for (const { uri } of [...this.results.values()]) if (!found.has(uri.toString()) && !this.document(uri)) this.remove(uri);
    } finally { if (this.discovery === cancel) { this.scanning = false; this.updateStatus(); } cancel.dispose(); }
  }
  updateStatus() {
    if (this.disposed) return;
    const busy = this.scanning || this.active > 0 || this.queue.size > 0;
    this.status.severity = this.skipped ? (this.v.LanguageStatusSeverity?.Warning ?? 1) : (this.v.LanguageStatusSeverity?.Information ?? 0);
    this.status.busy = busy; this.status.text = busy ? 'Siege: indexing' : 'Siege: ready';
    this.status.detail = `${this.results.size} files indexed · ${this.queue.size + this.active} pending${this.skipped ? ` · ${this.skipped} skipped (see log)` : ''}`;
  }
  dispose() { this.disposed = true; this.discovery?.cancel(); this.discovery?.dispose(); for (const timer of this.timers.values()) clearTimeout(timer); this.timers.clear(); this.queue.clear(); this.client.dispose(); }
}
module.exports = { Project, GLOB, LANGUAGE_IDS };
