// Checks language files against the English base: valid JSON, no missing or unknown keys,
// and the same {placeholders} in every string.
//
// Usage:  node tools/check-lang.js              (all built-in files in public/lang)
//         node tools/check-lang.js my-lang.json (one given file, e.g. your own translation)
const fs = require('fs');
const path = require('path');

const langDir = path.join(__dirname, '..', 'public', 'lang');
const base = JSON.parse(fs.readFileSync(path.join(langDir, 'en.json'), 'utf8'));
const keys = (o) => Object.keys(o).filter((k) => !k.startsWith('_'));
const params = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

const args = process.argv.slice(2);
const files = args.length ? args : fs.readdirSync(langDir).filter((f) => f.endsWith('.json')).map((f) => path.join(langDir, f));

let problems = 0;
for (const file of files) {
  const name = path.basename(file);
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    console.log(`ERROR ${name}: invalid JSON (${e.message})`);
    problems++;
    continue;
  }
  const issues = [];
  if (!data._meta || !data._meta.name) issues.push('missing _meta.name');
  if (data._meta && data._meta.dir && !['ltr', 'rtl'].includes(data._meta.dir)) issues.push('_meta.dir must be "ltr" or "rtl"');
  for (const k of keys(base)) {
    if (!(k in data)) issues.push(`missing key: ${k}`);
    else if (typeof data[k] !== 'string' || !data[k].trim()) issues.push(`empty or not a string: ${k}`);
    else if (params(data[k]) !== params(base[k])) issues.push(`different {placeholders}: ${k} (English: ${params(base[k]) || 'none'}, here: ${params(data[k]) || 'none'})`);
  }
  for (const k of keys(data)) if (!(k in base)) issues.push(`unknown key: ${k}`);
  if (issues.length) {
    problems += issues.length;
    console.log(`ERROR ${name}:\n  - ${issues.join('\n  - ')}`);
  } else console.log(`OK    ${name} (${data._meta.name}, ${keys(data).length} keys)`);
}
process.exit(problems ? 1 : 0);
