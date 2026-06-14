import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(__dirname, 'src');
const de = JSON.parse(fs.readFileSync(path.join(srcDir, 'i18n/locales/de.json'), 'utf8'));
const en = JSON.parse(fs.readFileSync(path.join(srcDir, 'i18n/locales/en.json'), 'utf8'));

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === '__tests__' || e.name === 'i18n') continue;
      walk(p, acc);
    } else if (/\.(jsx?|tsx?)$/.test(e.name)) {
      acc.push(p);
    }
  }
  return acc;
}

function getByPath(obj, keyPath) {
  const parts = keyPath.split('.');
  let cur = obj;
  for (const part of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[part];
  }
  return cur;
}

const files = walk(srcDir);

// Match t('...') / t("...") with optional second arg. Capture key and whether options has count.
// We capture the full call to inspect for count / interpolation.
const usages = []; // {key, file, line, hasCount, rawCall, optionsRaw}

// regex to find t( '...' ) or t( "..." ) ; also i18nKey="..."
const callRe = /\bt\(\s*(['"`])((?:\\.|(?!\1).)*?)\1\s*(,\s*\{[\s\S]*?\})?\s*\)/g;

for (const f of files) {
  const txt = fs.readFileSync(f, 'utf8');
  const lines = txt.split('\n');
  let m;
  callRe.lastIndex = 0;
  while ((m = callRe.exec(txt)) !== null) {
    const key = m[2];
    // skip template-literal keys with interpolation
    if (key.includes('${')) continue;
    const optionsRaw = m[3] || '';
    const idx = m.index;
    const line = txt.slice(0, idx).split('\n').length;
    usages.push({ key, file: path.relative(srcDir, f), line, optionsRaw, rawCall: m[0].slice(0, 120) });
  }
  // i18nKey="..."
  const i18nKeyRe = /i18nKey=\{?\s*(['"`])((?:\\.|(?!\1).)*?)\1/g;
  let k;
  while ((k = i18nKeyRe.exec(txt)) !== null) {
    const key = k[2];
    if (key.includes('${')) continue;
    const line = txt.slice(0, k.index).split('\n').length;
    usages.push({ key, file: path.relative(srcDir, f), line, optionsRaw: '', rawCall: k[0], isTrans: true });
  }
}

// Dedup by key for existence checks but keep all for count checks
const missingDe = [];
const missingEn = [];
const countNoPlural = [];
const interpMismatch = [];

for (const u of usages) {
  // For plural keys, i18next looks up key_one/key_other. Existence: base key may not exist directly.
  const hasCount = /count\s*:/.test(u.optionsRaw);
  const deVal = getByPath(de, u.key);
  const enVal = getByPath(en, u.key);

  if (hasCount) {
    // need key_one and key_other (de) for plural; check existence of plural forms
    const deOne = getByPath(de, u.key + '_one');
    const deOther = getByPath(de, u.key + '_other');
    const enOne = getByPath(en, u.key + '_one');
    const enOther = getByPath(en, u.key + '_other');
    const dePluralExists = deOne !== undefined || deOther !== undefined;
    const enPluralExists = enOne !== undefined || enOther !== undefined;
    if (deVal === undefined && !dePluralExists) missingDe.push({ ...u, kind: 'plural-missing' });
    if (enVal === undefined && !enPluralExists) missingEn.push({ ...u, kind: 'plural-missing' });
    if (deVal !== undefined && !dePluralExists) countNoPlural.push({ ...u, lng: 'de' });
    if (enVal !== undefined && !enPluralExists) countNoPlural.push({ ...u, lng: 'en' });
  } else {
    if (deVal === undefined) missingDe.push(u);
    if (enVal === undefined) missingEn.push(u);
  }

  // interpolation: collect {{name}} placeholders in the de value and verify options provides them
  if (typeof deVal === 'string') {
    const placeholders = [...deVal.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)].map(x => x[1]);
    const uniq = [...new Set(placeholders)];
    if (uniq.length > 0) {
      for (const ph of uniq) {
        const provided = new RegExp('[\\{,]\\s*' + ph + '\\s*:').test(u.optionsRaw) ||
                         new RegExp('[\\{,]\\s*' + ph + '\\s*[,\\}]').test(u.optionsRaw); // shorthand {name}
        if (!provided) {
          interpMismatch.push({ ...u, placeholder: ph, deVal });
        }
      }
    }
  }
}

function fmt(arr) {
  return arr.map(u => `  ${u.key}  (${u.file}:${u.line})${u.lng?' ['+u.lng+']':''}${u.placeholder?' missing {{'+u.placeholder+'}}':''}${u.kind?' '+u.kind:''}`).join('\n');
}

// dedup helper
const uniqKeys = a => {
  const seen = new Set(); const out=[];
  for (const u of a){ const id=u.key+'|'+u.file+'|'+u.line+'|'+(u.placeholder||'')+'|'+(u.lng||''); if(!seen.has(id)){seen.add(id);out.push(u);} }
  return out;
};

console.log('TOTAL usages found:', usages.length);
console.log('\n=== MISSING in de.json (raw key renders) ===');
console.log(fmt(uniqKeys(missingDe)) || '  (none)');
console.log('\n=== MISSING in en.json ===');
console.log(fmt(uniqKeys(missingEn)) || '  (none)');
console.log('\n=== count used but NO _one/_other plural ===');
console.log(fmt(uniqKeys(countNoPlural)) || '  (none)');
console.log('\n=== interpolation mismatch (key expects {{x}}, caller passes none) ===');
console.log(fmt(uniqKeys(interpMismatch)) || '  (none)');

// Legacy _plural suffix keys in json (i18next v21+ ignores these; v26 needs _one/_other)
function findSuffix(obj, suffix, prefix='', acc=[]) {
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    const full = prefix ? prefix+'.'+k : k;
    if (k.endsWith(suffix)) acc.push(full);
    if (v && typeof v === 'object' && !Array.isArray(v)) findSuffix(v, suffix, full, acc);
  }
  return acc;
}
console.log('\n=== legacy _plural keys in de.json ===');
console.log(findSuffix(de, '_plural').map(x=>'  '+x).join('\n') || '  (none)');
console.log('\n=== legacy _plural keys in en.json ===');
console.log(findSuffix(en, '_plural').map(x=>'  '+x).join('\n') || '  (none)');

// keys that have _one but not _other or vice versa
function pluralPairs(obj, prefix='', acc={ones:[],others:[]}) {
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    const full = prefix ? prefix+'.'+k : k;
    if (k.endsWith('_one')) acc.ones.push(full.slice(0,-4));
    if (k.endsWith('_other')) acc.others.push(full.slice(0,-6));
    if (v && typeof v === 'object' && !Array.isArray(v)) pluralPairs(v, full, acc);
  }
  return acc;
}
const dp = pluralPairs(de), ep = pluralPairs(en);
console.log('\n=== de: _one without _other ===', dp.ones.filter(x=>!dp.others.includes(x)).join(', ')||'(none)');
console.log('=== de: _other without _one ===', dp.others.filter(x=>!dp.ones.includes(x)).join(', ')||'(none)');
console.log('=== en: _one without _other ===', ep.ones.filter(x=>!ep.others.includes(x)).join(', ')||'(none)');
console.log('=== en: _other without _one ===', ep.others.filter(x=>!ep.ones.includes(x)).join(', ')||'(none)');
