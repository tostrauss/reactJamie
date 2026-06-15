import fs from 'fs';
import path from 'path';

const ROOT = 'c:/Users/tobia/Desktop/trys/frontend/src';
const de = JSON.parse(fs.readFileSync(path.join(ROOT, 'i18n/locales/de.json'), 'utf8'));
const en = JSON.parse(fs.readFileSync(path.join(ROOT, 'i18n/locales/en.json'), 'utf8'));

function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      flatten(v, key, out);
    } else {
      out[key] = v;
    }
  }
  return out;
}
const deFlat = flatten(de);
const enFlat = flatten(en);

function has(flat, key) {
  if (key in flat) return true;
  // plural forms
  if ((key + '_one') in flat || (key + '_other') in flat) return true;
  // array access like x.0
  return false;
}

// collect files
function walk(dir, files = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'i18n' || e.name === '__tests__' || e.name === 'node_modules') continue;
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) walk(fp, files);
    else if (/\.(jsx?|tsx?)$/.test(e.name)) files.push(fp);
  }
  return files;
}
const files = walk(ROOT);

// Extract t('...') and t("...") keys (static only). Capture interpolation args.
const usages = []; // {key, file, line, args:Set, raw}
const keyRe = /\bt\(\s*(['"`])([^'"`]+?)\1\s*(?:,\s*\{([^}]*)\})?\s*\)/g;
// also i18nKey="..."
const i18nKeyRe = /i18nKey=(['"])([^'"]+)\1/g;

for (const f of files) {
  const txt = fs.readFileSync(f, 'utf8');
  const lines = txt.split('\n');
  let m;
  while ((m = keyRe.exec(txt))) {
    const key = m[2];
    if (key.includes('${') ) continue; // dynamic template - skip from "static" but flag separately
    const upto = txt.slice(0, m.index);
    const line = upto.split('\n').length;
    const args = new Set();
    if (m[3]) {
      // parse arg keys
      const argstr = m[3];
      const ar = /([a-zA-Z0-9_]+)\s*:/g;
      let am;
      while ((am = ar.exec(argstr))) args.add(am[1]);
    }
    usages.push({ key, file: path.relative(ROOT, f), line, args, hasCount: m[3] ? /\bcount\b/.test(m[3]) : false, raw: m[0] });
  }
  while ((m = i18nKeyRe.exec(txt))) {
    const key = m[2];
    if (key.includes('${')) continue;
    const upto = txt.slice(0, m.index);
    const line = upto.split('\n').length;
    usages.push({ key, file: path.relative(ROOT, f), line, args: new Set(), hasCount: false, raw: m[0], i18nKey: true });
  }
}

// MISSING keys
const missingDe = [];
const missingEn = [];
const seen = new Set();
for (const u of usages) {
  const id = u.key + '|' + u.file + '|' + u.line;
  if (!has(deFlat, u.key)) missingDe.push(u);
  if (!has(enFlat, u.key)) missingEn.push(u);
}

console.log('=== TOTAL static usages:', usages.length, '===');
console.log('\n=== MISSING in de.json (' + missingDe.length + ') ===');
for (const u of missingDe) console.log(`${u.key}  @ ${u.file}:${u.line}  ${u.raw}`);
console.log('\n=== MISSING in en.json (' + missingEn.length + ') ===');
for (const u of missingEn) console.log(`${u.key}  @ ${u.file}:${u.line}  ${u.raw}`);
