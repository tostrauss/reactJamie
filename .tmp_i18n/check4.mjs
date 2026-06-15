import fs from 'fs';
import path from 'path';
const ROOT = 'c:/Users/tobia/Desktop/trys/frontend/src';
function walk(dir, files = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'i18n' || e.name === '__tests__' || e.name === 'node_modules') continue;
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) walk(fp, files);
    else if (/\.(jsx?)$/.test(e.name)) files.push(fp);
  }
  return files;
}
const files = walk(ROOT);
const germanRe = /[äöüÄÖÜß]|\b(und|oder|für|nicht|wird|deine|deinen|kein|keine|wähle|bitte|fehlgeschlagen|erstellen|löschen|gesendet|Nachricht|Gruppe|Mitglied|Anfrage|Speichern|Abbrechen|Weiter|wurde|konnte|erfolgreich)\b/;
// look at toast.success/error, alert(, confirm(, setError(, throw new Error( with literal string
const fnRe = /\b(toast\.(?:success|error|info)|alert|window\.confirm|confirm|setError)\(\s*(['"])([^'"]{4,})\2/g;
for (const f of files) {
  const lines = fs.readFileSync(f,'utf8').split('\n');
  lines.forEach((ln,i)=>{
    const trimmed = ln.trim();
    if (trimmed.startsWith('//')||trimmed.startsWith('*')) return;
    let m;
    while((m=fnRe.exec(ln))){
      const s = m[3];
      if (germanRe.test(s)) console.log(`${path.relative(ROOT,f)}:${i+1}  ${m[1]}('${s.slice(0,60)}')`);
    }
  });
}
