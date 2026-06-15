import fs from 'fs';
import path from 'path';

const ROOT = 'c:/Users/tobia/Desktop/trys/frontend/src';
const de = JSON.parse(fs.readFileSync(path.join(ROOT, 'i18n/locales/de.json'), 'utf8'));
const en = JSON.parse(fs.readFileSync(path.join(ROOT, 'i18n/locales/en.json'), 'utf8'));

function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
    else out[key] = v;
  }
  return out;
}
const deFlat = flatten(de);
const enFlat = flatten(en);

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

// ---- 1. dynamic template-literal keys
console.log('=== DYNAMIC template-literal t(`...`) keys ===');
const dynRe = /\bt\(\s*`([^`]+)`/g;
for (const f of files) {
  const txt = fs.readFileSync(f, 'utf8');
  let m;
  while ((m = dynRe.exec(txt))) {
    const line = txt.slice(0, m.index).split('\n').length;
    console.log(`${path.relative(ROOT, f)}:${line}  t(\`${m[1]}\`)`);
  }
}

// ---- 2. legacy _plural suffix keys (i18next v26 ignores _plural; needs _one/_other)
console.log('\n=== legacy *_plural keys in locale files ===');
for (const k of Object.keys(deFlat)) if (k.endsWith('_plural')) console.log('de:', k);
for (const k of Object.keys(enFlat)) if (k.endsWith('_plural')) console.log('en:', k);

// ---- 3. keys with _one but no _other and vice versa
console.log('\n=== plural pairs imbalance ===');
const bases = new Set();
for (const k of Object.keys(deFlat)) {
  if (k.endsWith('_one')) bases.add(k.slice(0, -4));
  if (k.endsWith('_other')) bases.add(k.slice(0, -6));
}
for (const b of bases) {
  const hasOneDe = (b+'_one') in deFlat, hasOtherDe = (b+'_other') in deFlat;
  const hasOneEn = (b+'_one') in enFlat, hasOtherEn = (b+'_other') in enFlat;
  if (!hasOneDe || !hasOtherDe) console.log('de imbalance:', b, {one:hasOneDe, other:hasOtherDe});
  if (!hasOneEn || !hasOtherEn) console.log('en imbalance:', b, {one:hasOneEn, other:hasOtherEn});
}

// ---- 4. count usage without plural forms; and plural keys called without count
console.log('\n=== t() with {count} where key has NO plural forms (would not pluralize) ===');
const keyRe = /\bt\(\s*(['"`])([^'"`]+?)\1\s*,\s*\{([^}]*)\}\s*\)/g;
const usageByKey = {}; // key -> {count:bool, files:Set}
for (const f of files) {
  const txt = fs.readFileSync(f, 'utf8');
  let m;
  while ((m = keyRe.exec(txt))) {
    const key = m[2]; if (key.includes('${')) continue;
    const argstr = m[3];
    const line = txt.slice(0, m.index).split('\n').length;
    const hasCount = /\bcount\s*:/.test(argstr);
    if (!usageByKey[key]) usageByKey[key] = { count:false, plain:false, locs:[] };
    if (hasCount) usageByKey[key].count = true; else usageByKey[key].plain = true;
    usageByKey[key].locs.push(`${path.relative(ROOT,f)}:${line}`);
  }
}
for (const [key, info] of Object.entries(usageByKey)) {
  if (!info.count) continue;
  const isPlural = (key+'_one') in deFlat || (key+'_other') in deFlat;
  const isFlat = key in deFlat;
  // if key has plural form -> fine. If only flat exists, the {count} can still interpolate but no plural selection
  // flag those that have a flat value referencing {{count}} but no plural variants -> acceptable if intended singular-only
  if (!isPlural && !isFlat) console.log('count-key MISSING entirely:', key, info.locs.join(', '));
}

// ---- 5. plural keys USED without count arg
console.log('\n=== plural-form keys USED WITHOUT count arg ===');
for (const [key, info] of Object.entries(usageByKey)) {
  const isPlural = (key+'_one') in deFlat || (key+'_other') in deFlat;
  if (isPlural && info.plain) console.log('plural key used w/o count:', key, info.locs.join(', '));
}

// ---- 6. interpolation mismatch: key value has {{x}} placeholders but caller passes no/insufficient args
console.log('\n=== interpolation: locale value has {{placeholders}}; check callers ===');
// gather all callers per key with their arg names
const callRe = /\bt\(\s*(['"`])([^'"`]+?)\1\s*(?:,\s*\{([^}]*)\})?\s*\)/g;
const callsByKey = {};
for (const f of files) {
  const txt = fs.readFileSync(f, 'utf8');
  let m;
  while ((m = callRe.exec(txt))) {
    const key = m[2]; if (key.includes('${')) continue;
    const args = new Set();
    if (m[3]) { let am; const ar=/([a-zA-Z0-9_]+)\s*:/g; while((am=ar.exec(m[3]))) args.add(am[1]); }
    const line = txt.slice(0, m.index).split('\n').length;
    (callsByKey[key] = callsByKey[key]||[]).push({args, loc:`${path.relative(ROOT,f)}:${line}`, hasObj: !!m[3]});
  }
}
function placeholders(val){ const s=new Set(); if(typeof val!=='string') return s; let m; const r=/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g; while((m=r.exec(val))) s.add(m[1]); return s; }
for (const [key, calls] of Object.entries(callsByKey)) {
  // resolve value (prefer flat, else _other)
  let val = deFlat[key]; if (val===undefined) val = deFlat[key+'_other'] ?? deFlat[key+'_one'];
  const ph = placeholders(val);
  if (ph.size===0) continue;
  for (const c of calls) {
    const missing = [...ph].filter(p => p!=='count' ? !c.args.has(p) : !c.args.has('count'));
    if (missing.length) console.log(`MISMATCH ${key} expects {${[...ph].join(',')}} but caller passes {${[...c.args].join(',')}} @ ${c.loc}`);
  }
}
