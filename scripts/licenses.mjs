/**
 * Writes public/licenses.txt: the licence notices of every production
 * dependency bundled into Calci (required by MIT / Apache-2.0 / ISC terms).
 *
 *   node scripts/licenses.mjs
 */
import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const tree = JSON.parse(execSync('npm ls --omit=dev --all --json', { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
const seen = new Map();
const walk = (deps) => {
  for (const [name, info] of Object.entries(deps ?? {})) {
    if (!seen.has(name)) seen.set(name, info.version);
    walk(info.dependencies);
  }
};
walk(tree.dependencies);

let out = `Calci — third-party software notices
=====================================

Calci is built on the open-source packages listed below. Each is used under the
terms of its licence, reproduced here. Python support loads Pyodide
(Mozilla Public License 2.0) from cdn.jsdelivr.net at runtime only when a Python
script is run; it is not bundled.

`;
for (const [name, version] of [...seen].sort((a, b) => a[0].localeCompare(b[0]))) {
  const dir = join('node_modules', name);
  if (!existsSync(dir)) continue;
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const lic = typeof pkg.license === 'string' ? pkg.license : pkg.license?.type ?? 'see package';
  const file = readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\.|$)/i.test(f));
  const text = file ? readFileSync(join(dir, file), 'utf8').trim() : '';
  out += `\n------------------------------------------------------------------------\n${name}@${version} — ${lic}\n${pkg.homepage ?? pkg.repository?.url ?? ''}\n\n${text}\n`;
}
writeFileSync('public/licenses.txt', out);
console.log(`Wrote notices for ${seen.size} packages`);
