'use strict';
const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process');
const root = path.join(__dirname, '..'); let count = 0;
function walk(dir) { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { if (['node_modules', '.test-workspace', 'dist'].includes(e.name)) continue; const file = path.join(dir, e.name); if (e.isDirectory()) walk(file); else if (e.name.endsWith('.js')) { cp.execFileSync(process.execPath, ['--check', file]); count++; } else if (e.name.endsWith('.json')) JSON.parse(fs.readFileSync(file, 'utf8')); } }
walk(root);
const pkg = require('../package.json');
for (const g of pkg.contributes.grammars) { const data = JSON.parse(fs.readFileSync(path.join(root, g.path), 'utf8')); if (g.scopeName !== data.scopeName) throw Error('Grammar scope mismatch'); }
for (const l of pkg.contributes.languages) if (l.configuration && !fs.existsSync(path.join(root, l.configuration))) throw Error('Missing language configuration');
console.log(`Checked ${count} JS modules, all JSON and contribution paths.`);
