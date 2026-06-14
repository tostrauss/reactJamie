import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const de = JSON.parse(fs.readFileSync(path.join(__dirname,'src/i18n/locales/de.json'),'utf8'));
const en = JSON.parse(fs.readFileSync(path.join(__dirname,'src/i18n/locales/en.json'),'utf8'));

// German-only diacritics / words that strongly indicate untranslated German in en.json
const deMarkers = /[äöüß]|\b(und|oder|der|die|das|nicht|wird|werden|kannst|deine|deinen|Schließen|Mitglieder|Gruppe|Nutzer|Fehler|gesendet|laden|wirklich|löschen|erstellen)\b/;

function walk(o, prefix='') {
  const out=[];
  for (const k of Object.keys(o)) {
    const v=o[k]; const full=prefix?prefix+'.'+k:k;
    if (typeof v==='string') out.push([full,v]);
    else if (Array.isArray(v)) v.forEach((x,i)=>{ if(typeof x==='string') out.push([full+'['+i+']',x]); else if(x&&typeof x==='object') for(const kk of Object.keys(x)) out.push([full+'['+i+'].'+kk, x[kk]]); });
    else if (v&&typeof v==='object') out.push(...walk(v,full));
  }
  return out;
}
const enLeaves = walk(en);
const deMap = Object.fromEntries(walk(de));

console.log('=== en.json leaves containing German markers (possible untranslated) ===');
let n=0;
for (const [k,v] of enLeaves) {
  if (deMarkers.test(v)) { console.log(`  ${k} = "${v}"`); n++; }
}
if(!n) console.log('  (none)');

console.log('\n=== en.json leaves IDENTICAL to de.json (excluding brand/empty/short) ===');
let m=0;
for (const [k,v] of enLeaves) {
  const dv = deMap[k];
  if (dv === v && v.trim().length > 2 && !/^[0-9€$%\/.,:\s]+$/.test(v)) {
    // skip obvious brand/identical tokens
    if (['JAMIE','Spotify','Stripe','CSV','Apple Pay','Hall of Fame','Pro','App','Bio','Demo'].some(b=>v.includes(b)) && v.length<22) continue;
    console.log(`  ${k} = "${v}"`); m++;
  }
}
if(!m) console.log('  (none)');
