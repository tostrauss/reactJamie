import fs from 'fs';
import path from 'path';

const ROOT = 'c:/Users/tobia/Desktop/trys/frontend/src';
function walk(dir, files = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'i18n' || e.name === '__tests__' || e.name === 'node_modules') continue;
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) walk(fp, files);
    else if (/\.(jsx)$/.test(e.name)) files.push(fp);
  }
  return files;
}
const files = walk(ROOT);

// German indicator words / umlauts to find untranslated UI text
const germanRe = /[äöüÄÖÜß]|\b(und|oder|der|die|das|für|nicht|wird|deine|deinen|deinem|kein|keine|wähle|bitte|fehlgeschlagen|erstellen|löschen|gesendet|Nachricht|Gruppe|Mitglied|Anfrage|Zurück|Speichern|Abbrechen|Weiter|noch|schon|jetzt|hier|alle|mehr)\b/i;

// JSX text content between > and < (not containing { } tags)
for (const f of files) {
  const lines = fs.readFileSync(f, 'utf8').split('\n');
  lines.forEach((ln, i) => {
    // skip comment lines
    const trimmed = ln.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
    // JSX text node:  >Text<   where Text has letters and no {
    let m;
    const re = />([^<>{}]*[A-Za-zÄÖÜäöü][^<>{}]*)</g;
    while ((m = re.exec(ln))) {
      const text = m[1].trim();
      if (!text) continue;
      if (text.length < 3) continue;
      if (/^[\d\s.,:%/–—✕✓→←👑🚀📅📍🔒🔔🍎📸🗳️✨⏳⚡✍️]+$/.test(text)) continue;
      if (germanRe.test(text)) {
        console.log(`${path.relative(ROOT,f)}:${i+1}  >${text}<`);
      }
    }
    // placeholder= / aria-label= / title= literal strings (not {t(...)})
    const attrRe = /(placeholder|aria-label|title|alt)=("([^"]+)"|'([^']+)')/g;
    let am;
    while ((am = attrRe.exec(ln))) {
      const val = am[3] || am[4] || '';
      if (germanRe.test(val)) console.log(`${path.relative(ROOT,f)}:${i+1}  ${am[1]}="${val}"`);
    }
  });
}
