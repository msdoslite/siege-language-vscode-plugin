'use strict';
const { Worker } = require('node:worker_threads');
const path = require('node:path');
class AnalyzerClient {
  constructor() { this.pending = new Map(); this.nextId = 0; this.disposed = false; }
  start() {
    if (this.worker || this.disposed) return;
    const worker = this.worker = new Worker(path.join(__dirname, 'worker.js'));
    worker.on('message', msg => { const p = this.pending.get(msg.id); if (!p) return; this.pending.delete(msg.id); clearTimeout(p.timer); if (msg.error) p.reject(Error(msg.error)); else p.resolve(msg); });
    const fail = error => { if (this.worker !== worker) return; this.worker = null; for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(error); } this.pending.clear(); };
    worker.on('error', fail); worker.on('exit', code => fail(Error(`Analyzer worker stopped (${code}).`)));
  }
  analyze(text, language, options, detailed = false) {
    if (this.disposed) return Promise.reject(Error('Analyzer disposed'));
    this.start(); const id = ++this.nextId;
    // VS Code configuration values can be read-only proxies, not structured-cloneable.
    const plainOptions = JSON.parse(JSON.stringify(options || {}));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { const worker = this.worker; this.worker = null; if (worker) worker.terminate(); for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(Error('Analyzer exceeded its time budget.')); } this.pending.clear(); }, 15000);
      this.pending.set(id, { resolve, reject, timer });
      try { this.worker.postMessage({ id, text, language, options: plainOptions, detailed }); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  dispose() { this.disposed = true; for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(Error('Analyzer disposed')); } this.pending.clear(); if (this.worker) this.worker.terminate(); this.worker = null; }
}
module.exports = { AnalyzerClient };
