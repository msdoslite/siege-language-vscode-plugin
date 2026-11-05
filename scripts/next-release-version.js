'use strict';
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

// Release versions are 1.<minor>.0. Compare numerically, so 1.10 follows 1.9.
function nextVersion(tags) {
  const minors = tags.map(tag => /^v?1\.(0|[1-9]\d*)\.0$/.exec(tag.trim()))
    .filter(Boolean).map(match => Number(match[1]));
  const minor = minors.length ? Math.max(...minors) + 1 : 0;
  if (!Number.isSafeInteger(minor)) throw new Error('Release version is out of range');
  return `1.${minor}.0`;
}

if (require.main === module) {
  const tags = execFileSync('git', ['tag', '--list'], { encoding: 'utf8' }).trim().split(/\r?\n/);
  const version = nextVersion(tags);
  const outputs = `version=${version}\ntag=v${version}\nasset=siege-language-tools-${version}.vsix\n`;
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, outputs);
  process.stdout.write(outputs);
}
module.exports = { nextVersion };
