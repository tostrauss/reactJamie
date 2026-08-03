# 🇫🇷🇪🇸 Frankreich + Spanien Rollout — Morgen-Checkliste (04.08.2026)

> Über Nacht gebaut (Commit `b4df34e`, lokal, **noch nicht gepusht**). Die App
> spricht jetzt Französisch + Spanisch und erlaubt Registrierung + Gruppen-/
> Club-/Deal-Erstellung in FR + ES. Alles getestet: 97 Backend- + 15 Frontend-
> Tests grün, Vite-Build erzeugt die fr/es-Sprachpakete.

## ✅ Was fertig ist (im Commit `b4df34e`)

- **Länder-Gates:** Backend-Defaults (Registrierungs-Geofence + Erstell-Gate)
  von `AT,DE,CH,IT` → `AT,DE,CH,IT,FR,ES`. Frontend `regions.js` inkl.
  Google-Places-Beschränkung + Web-PWA-Geofence-Boxen für Frankreich
  (Festland+Korsika) und Spanien (Festland+Balearen, Kanaren extra).
- **Komplette Übersetzungen:** `fr.json` + `es.json` — alle 1437 Keys,
  Key-Struktur + {{Platzhalter}} maschinell gegen de.json validiert.
  Sprachwahl in Einstellungen: DE / EN / IT / FR / ES.
- **Push-Benachrichtigungen** auf Französisch + Spanisch (Kategorie-Push,
  Digest, Beitrittsanfrage).
- **Datums-Formatierung** (fr-FR / es-ES) in allen 14 Stellen.
- **Vier-Länder-Texte aktualisiert:** de/en/it-Strings, die die Länder
  aufzählen („Nur Standorte in…", OutOfRegion) nennen jetzt alle sechs.

## ⚠️ DEINE Schritte heute früh (in dieser Reihenfolge)

1. **Railway env `ALLOWED_COUNTRIES` prüfen** (Service reactJamie → Variables):
   - Wenn **nicht gesetzt** → nichts tun (Code-Default greift: AT,DE,CH,IT,FR,ES).
   - Wenn **gesetzt** (z. B. `AT,DE,CH,IT`) → auf `AT,DE,CH,IT,FR,ES` ändern
     **oder löschen**. ⚠️ Sonst überschreibt die env den neuen Code-Default und
     FR/ES bleiben trotz Deploy gesperrt!
2. **`git push`** → Railway-Deploy abwarten.
3. **Play Console → Länder/Regionen:**
   - Frankreich hast du gestern Nacht schon eingereicht ✓
   - **Spanien hinzufügen** (fehlt noch — du hattest DE/CH/IT/FR angehakt).
4. **Play Console → Store-Eintrag:** Übersetzungen **Französisch (fr-FR)** und
   **Spanisch (es-ES)** anlegen (Texte unten — copy/paste).
5. **Optional iOS (App Store Connect):** Pricing & Availability → Frankreich +
   Spanien hinzufügen, sobald du willst, dass auch iOS dort verfügbar ist.
   (Web/Android funktionieren unabhängig davon sofort.)

## Smoke-Test nach dem Deploy (2 Min.)

- Einstellungen → Sprache **FR** → App ist Französisch; **ES** → Spanisch.
- Gruppe mit Ort „Paris" erstellen → funktioniert (kein Region-Fehler mehr).
- Gruppe mit Ort „Madrid" erstellen → funktioniert.
- Gruppe mit Ort „Lissabon" → weiterhin 400 (PT bleibt zu — korrekt).

## 📦 Play-Store-Texte (copy/paste)

### Französisch (fr-FR)

**Titel (30):** `JAMIE – Activités & groupes`

**Kurzbeschreibung (80):**
`Trouve des gens pour de vraies activités près de chez toi – spontané et simple.`

**Beschreibung:**
```
JAMIE te connecte avec des personnes près de chez toi qui aiment les mêmes
activités que toi — sport, culture, sorties, cuisine et bien plus.

• Groupes : des événements ponctuels pour 3 à 10 personnes
• Clubs : des communautés durables qui se retrouvent régulièrement
• Carte : découvre ce qui se passe autour de toi
• Chat : discute directement avec ton groupe
• Amis : construis ton réseau pour de vraies rencontres

Crée ton propre groupe en une minute, invite des amis et vis des moments
inoubliables. JAMIE est disponible en Autriche, Allemagne, Suisse, Italie,
France et Espagne.
```

**Was ist neu (fr):**
```
• JAMIE parle maintenant français ! 🇫🇷
• Crée des groupes et des clubs partout en France
• Améliorations et corrections de bugs
```

### Spanisch (es-ES)

**Titel (30):** `JAMIE – Actividades y grupos`

**Kurzbeschreibung (80):**
`Encuentra gente para actividades reales cerca de ti – espontáneo y sencillo.`

**Beschreibung:**
```
JAMIE te conecta con personas cerca de ti que aman las mismas actividades que
tú — deporte, cultura, salir, cocinar y mucho más.

• Grupos: eventos puntuales para 3–10 personas
• Clubes: comunidades duraderas que se reúnen regularmente
• Mapa: descubre lo que pasa a tu alrededor
• Chat: habla directamente con tu grupo
• Amigos: construye tu red para encuentros reales

Crea tu propio grupo en un minuto, invita a amigos y vive momentos
inolvidables. JAMIE está disponible en Austria, Alemania, Suiza, Italia,
Francia y España.
```

**Was ist neu (es):**
```
• ¡JAMIE ahora habla español! 🇪🇸
• Crea grupos y clubes en toda España
• Mejoras y corrección de errores
```

## 📌 Offene Punkte (Fast-Follow, blockiert NICHT)

- **Muttersprachliche Korrekturlesung** fr.json + es.json (maschinelle
  Übersetzung, Du-Form — gleicher Prozess wie damals it.json).
- **Rechtsseiten** (Impressum, Datenschutz, AGB, Community Guidelines) sind
  React-Seiten auf Deutsch → für Frankreich (Sprachpflicht, Loi Toubon) und
  Spanien mit Tina klären. UI selbst ist übersetzt.
- **iOS-Binary:** Sprachen kommen aufs iPhone erst mit dem nächsten
  App-Store-Build (iOS bündelt das Web — Android/Web sind sofort aktuell).
- Spanien-Geofence-Box deckt Portugal mit ab (bewusst, „soft gate" — das
  Backend blockt PT-Orte weiterhin serverseitig).
- Deals/„Für Dich"-Texte erwähnen Wien (faktisch korrekt — Partner sind in
  Wien; bei FR/ES-Partnern später anpassen).
