'use strict';
const { parentPort } = require('node:worker_threads');
const { analyze } = require('./core');
const { summarize } = require('./index-summary');
// Only the most recent requests live in the main-thread queue. The worker has no
// filesystem access, global project snapshots, timers, or VS Code dependencies.
parentPort.on('message', ({ id, text, language, options, detailed }) => {
  try {
    const start = performance.now(), full = analyze(text, language, options);
    const result = detailed ? full : summarize(full, language);
    parentPort.postMessage({ id, result, milliseconds: performance.now() - start });
  } catch (error) { parentPort.postMessage({ id, error: String(error.stack || error) }); }
});
