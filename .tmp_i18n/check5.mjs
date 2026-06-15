import fs from 'fs';
const en = JSON.parse(fs.readFileSync('c:/Users/tobia/Desktop/trys/frontend/src/i18n/locales/en.json','utf8'));
const de = JSON.parse(fs.readFileSync('c:/Users/tobia/Desktop/trys/frontend/src/i18n/locales/de.json','utf8'));
function flat(o,p='',out={}){for(const[k,v]of Object.entries(o)){const key=p?`${p}.${k}`:k;if(v&&typeof v==='object'&&!Array.isArray(v))flat(v,key,out);else if(Array.isArray(v))v.forEach((x,i)=>out[`${key}.${i}`]=x);else out[key]=v;}return out;}
const enF=flat(en), deF=flat(de);
// German indicators unlikely in correct English
const germanRe=/[äöüÄÖÜß]|\b(und|oder|für|nicht|wird|deine|deinen|kein|keine|wähle|bitte|fehlgeschlagen|erstellen|löschen|gesendet|Nachricht|Gruppe|Mitglied|Anfrage|Speichern|Abbrechen|Weiter|wurde|konnte|Käufe|wiederherstellen|Datenschutz|nicht|über)\b/;
console.log('=== en.json values that look German ===');
for(const[k,v]of Object.entries(enF)){
  if(typeof v!=='string')continue;
  if(germanRe.test(v)) console.log(`${k}: "${v}"`);
}
console.log('\n=== en values IDENTICAL to de (possible untranslated, excluding proper nouns/short) ===');
let cnt=0;
for(const[k,v]of Object.entries(enF)){
  if(typeof v!=='string')continue;
  if(deF[k]===v && v.length>3 && /[a-zA-Z]/.test(v)){
    // skip known-OK identical (brand, codes, placeholders)
    if(/JAMIE|Spotify|Stripe|Apple|Pay|Club|Hall of Fame|Pro|CSV|GIF|PNG|JPG|email|Email|@|XXXX|X7K2/.test(v)) { continue; }
    cnt++; if(cnt<=60) console.log(`${k}: "${v}"`);
  }
}
console.log('total identical(after filter):',cnt);
