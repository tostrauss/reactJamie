# JAMIE — Social Activity App

Eine Full-Stack Progressive Web App (PWA) zum Entdecken und Beitreten von sozialen Aktivitäten in Österreich und Deutschland. Nutzer erstellen Gruppen und Clubs, chatten in Echtzeit, fügen Freunde hinzu und entdecken Events auf einer Karte.

**Zielmarkt:** Österreich / Deutschland — UI-Sprache: Deutsch.  
**Brandfarben:** Coral/Orange `#FD7666` (primär), Dunkelviolett `#1c1c2e` / `#242340` (Hintergründe).

---

## Projektstruktur

```
jamie/
├── backend/
│   ├── src/
│   │   ├── config/           # DB, Cloud-Storage (R2/S3), SQL-Migrationen
│   │   ├── controllers/      # Business-Logik (Auth, Groups, Messages, Boosts, Reports, Analytics, Admin)
│   │   ├── middleware/       # JWT-Auth, Validierung
│   │   ├── routes/           # API-Routen inkl. Upload, Reports, Push, Boosts
│   │   └── server.js         # Express + Socket.IO Einstiegspunkt
│   ├── tests/                # Vitest Backend-Tests (20 bestehen)
│   ├── package.json
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── components/       # Wiederverwendbare UI (ReportModal, EventReviewModal, AppIntro, …)
│   │   ├── context/          # Auth- und Socket-Context-Provider
│   │   ├── hooks/            # useAnalytics und weitere Custom Hooks
│   │   ├── pages/            # Home, Map, Profile, Admin, Boost, …
│   │   ├── styles/           # Globales CSS, Komponentenstile
│   │   ├── utils/            # api.js (Axios-Client)
│   │   ├── App.jsx           # React Router v6 Routen
│   │   └── main.jsx
│   ├── tests/                # Vitest + React Testing Library (10 bestehen)
│   ├── public/
│   │   ├── manifest.json     # PWA-Manifest (id + screenshots gesetzt)
│   │   └── assetlinks.json   # Android TWA Dual-Fingerprint Asset Links
│   ├── vite.config.js
│   └── package.json
├── twa/                      # Trusted Web Activity (Play Store)
│   ├── twa-manifest.json
│   ├── 1-generate-keystore.sh
│   ├── 2-get-sha256.sh
│   ├── 3-build.sh
│   └── 4-verify-assetlinks.sh
├── ios/                      # Capacitor iOS-Projekt
├── docker-compose.yml
└── package.json
```

---

## Features

| Bereich | Details |
|---|---|
| **Authentifizierung** | Registrierung / Login mit JWT; E-Mail-OTP-Verifizierung; Passwort-Policy (6+ Zeichen, Groß-/Kleinbuchstaben, Zahl, Sonderzeichen) |
| **Gruppen & Clubs** | Gruppen erstellen/beitreten/verlassen/favorisieren (3–10 Personen, mit Datum) und permanente Clubs |
| **Echtzeit-Chat** | Socket.IO Gruppen-Messaging |
| **Freunde** | Freundschaftsanfragen, Freundesliste |
| **Nutzerprofile** | Avatar-Upload, Bio, Musikgeschmack (Spotify), Vertrauensbadge |
| **Karte** | Leaflet-Karten-Tab, Nominatim-Geocoding, Kategorie-Filter-Pills mit Emojis, Wien als Standard-Zentrum |
| **Push-Benachrichtigungen** | VAPID Web-Push (Browser) + APNs via Capacitor (iOS/Android) |
| **Inhaltsmeldungen** | Nutzer/Gruppen melden; Admin erhält E-Mail-Benachrichtigung (`ADMIN_EMAIL`) |
| **Boost-System** | Kredit-basierte Boosts; Stripe (Apple Pay) + PayPal Checkout |
| **Empfehlungscodes** | Kredite durch Einladung anderer Nutzer verdienen |
| **Admin-Dashboard** | `/admin` geschützt durch `ADMIN_SECRET`; CSV-Export; Nutzer-/Gruppenstatistiken |
| **Event-Bewertungen** | `EventReviewModal` wird nach dem Login automatisch ausgelöst, wenn vergangene Events vorhanden sind |
| **Onboarding** | 3-Slide `AppIntro` beim ersten Start |
| **Telemetrie** | `useAnalytics`-Hook; Events: `screen_view`, `screen_leave`, `app_open`, `app_close` |
| **Cloud-Storage** | Uploads über Cloudflare R2 (S3-kompatibel) mit lokalem Fallback in der Entwicklung |
| **PWA / TWA** | Installierbare PWA; Android-TWA-Paket (`jamie.app`) für den Play Store |
| **iOS (Capacitor)** | App-Store-Build via Capacitor mit APNs-Push und Safe-Area-Inset-Unterstützung |

---

## Tech-Stack

### Backend
- Node.js + Express (ES Modules)
- PostgreSQL
- Socket.IO (Echtzeit-Chat)
- JWT-Authentifizierung + bcrypt
- Multer (Memory-Storage) + `@aws-sdk/client-s3` (Cloudflare R2 / AWS S3)
- `web-push` (VAPID Push-Benachrichtigungen)
- Nodemailer (E-Mail-OTP + Admin-Alerts)
- Stripe SDK + PayPal REST API (Boost-Zahlungen)
- Helmet (CSP aktiviert — Stripe, PayPal, R2-Domains whitelisted)

### Frontend
- React 18 + Vite
- React Router v6
- Axios
- Socket.IO Client
- Leaflet + react-leaflet v4.2.1 (Karte)
- Stripe.js (Apple Pay / Kartenzahlung)
- Capacitor (iOS + Android Native-Shell)

### Infrastruktur
- Deploy: Railway (Backend), Static-Host (Frontend)
- Docker Compose für lokale Entwicklung
- Beide Pakete verwenden `"type": "module"` (ESM)

---

## Umgebungsvariablen

`backend/.env.example` kopieren und alle Werte ausfüllen.

### Pflichtfelder

```env
# Server
PORT=5000
NODE_ENV=development
JWT_SECRET=dein_jwt_secret

# Datenbank
DB_HOST=localhost
DB_PORT=5432
DB_NAME=jamie_db
DB_USER=postgres
DB_PASSWORD=dein_passwort

# E-Mail (OTP + Admin-Alerts)
EMAIL_HOST=smtp.example.com
EMAIL_PORT=587
EMAIL_USER=deine@email.com
EMAIL_PASS=dein_email_passwort
ADMIN_EMAIL=admin@example.com

# Push-Benachrichtigungen (VAPID)
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:admin@example.com

# Admin-Dashboard
ADMIN_SECRET=dein_admin_secret

# Stripe (Boosts)
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...

# PayPal (Boosts)
PAYPAL_CLIENT_ID=...
PAYPAL_CLIENT_SECRET=...
```

### Cloud-Storage (Produktion — Cloudflare R2 oder AWS S3)

```env
STORAGE_ENDPOINT=https://<account>.r2.cloudflarestorage.com
STORAGE_ACCESS_KEY=...
STORAGE_SECRET_KEY=...
STORAGE_BUCKET=jamie-uploads
STORAGE_REGION=auto
STORAGE_PUBLIC_URL=https://pub-xxx.r2.dev
```

### Android TWA (Play Store)

```env
ANDROID_SHA256=<Fingerabdruck aus dem Keystore>
ANDROID_SHA256_PLAY=<Fingerabdruck aus der Play Console>
```

---

## Datenbank-Migrationen

Alle 5 Migrationsdateien **der Reihe nach** auf der Produktionsdatenbank ausführen:

```bash
psql -U postgres -d jamie_db -f backend/src/config/schema.sql
psql -U postgres -d jamie_db -f backend/src/config/reports_migration.sql
psql -U postgres -d jamie_db -f backend/src/config/push_subscriptions_migration.sql
psql -U postgres -d jamie_db -f backend/src/config/boost_migration.sql
psql -U postgres -d jamie_db -f backend/src/config/analytics_migration.sql
```

`analytics_migration.sql` erstellt auch die Tabelle `event_reviews` und die Spalte `trusted_count`.

---

## Lokale Entwicklung

### Voraussetzungen
- Node.js v18+
- PostgreSQL v14+
- Docker (optional, für `docker-compose`)

### Schnellstart mit Docker

```bash
docker-compose up
```

### Manuelles Setup

**Backend**
```bash
cd backend
npm install
cp .env.example .env   # Werte eintragen
npm run dev            # startet auf :5000
```

**Frontend**
```bash
cd frontend
npm install
npm run dev            # startet auf :3000
```

Der Vite-Dev-Server leitet `/api` und `/uploads` an `localhost:5000` weiter.

E-Mail-OTP wird in `NODE_ENV=development` übersprungen — der Verifizierungscode wird in der API-Antwort zurückgegeben und das Frontend bestätigt ihn automatisch (kein SMTP nötig).

---

## Tests ausführen

```bash
cd backend && npm test   # 20 Vitest-Tests
cd frontend && npm test  # 10 Vitest + RTL-Tests
```

---

## API-Endpunkte (Übersicht)

### Auth
| Methode | Pfad | Hinweis |
|---|---|---|
| POST | `/api/auth/register` | |
| POST | `/api/auth/login` | |
| POST | `/api/auth/send-code` | E-Mail-OTP |
| POST | `/api/auth/verify-code` | |
| GET | `/api/auth/profile` | auth |
| PUT | `/api/auth/profile` | auth |

### Gruppen & Clubs
| Methode | Pfad | Hinweis |
|---|---|---|
| GET | `/api/groups` | `?type=group\|club` Filter |
| GET | `/api/groups/:id` | |
| POST | `/api/groups` | auth |
| PUT | `/api/groups/:id` | auth, Eigentümer |
| POST | `/api/groups/:id/join` | auth |
| POST | `/api/groups/:id/leave` | auth |
| POST | `/api/groups/:id/favorite` | auth |
| GET | `/api/groups/user/favorites` | auth |
| GET | `/api/groups/user/joined` | auth |

### Nachrichten
| Methode | Pfad | Hinweis |
|---|---|---|
| GET | `/api/messages/:groupId` | auth |
| POST | `/api/messages` | auth |
| DELETE | `/api/messages/:messageId` | auth |

### Uploads
| Methode | Pfad | Hinweis |
|---|---|---|
| POST | `/api/upload/avatar` | auth, multipart |
| POST | `/api/upload/group-image` | auth, multipart |

### Meldungen
| Methode | Pfad | Hinweis |
|---|---|---|
| POST | `/api/reports` | auth |

### Push-Benachrichtigungen
| Methode | Pfad | Hinweis |
|---|---|---|
| POST | `/api/push/subscribe` | auth |
| DELETE | `/api/push/unsubscribe` | auth |

### Boosts
| Methode | Pfad | Hinweis |
|---|---|---|
| GET | `/api/boosts/credits` | auth |
| POST | `/api/boosts/stripe/create-intent` | auth |
| POST | `/api/boosts/paypal/create-order` | auth |
| POST | `/api/boosts/paypal/capture` | auth |
| POST | `/api/boosts/activate` | auth |
| POST | `/api/boosts/referral` | auth |

### Admin
| Methode | Pfad | Hinweis |
|---|---|---|
| GET | `/api/admin/stats` | `ADMIN_SECRET`-Header |
| GET | `/api/admin/export/users` | CSV |
| GET | `/api/admin/export/groups` | CSV |

---

## Android (TWA / Play Store)

```bash
cd twa
# 1. Signing-Keystore erstellen (einmalig)
bash 1-generate-keystore.sh
# 2. SHA-256-Fingerabdruck ausgeben → in assetlinks.json / .env eintragen
bash 2-get-sha256.sh
# 3. APK/AAB bauen
bash 3-build.sh
# 4. Assetlinks auf der Domain prüfen
bash 4-verify-assetlinks.sh
```

`twa/twa-manifest.json` vor dem Build mit der Produktionsdomain aktualisieren.  
`public/assetlinks.json` unterstützt zwei Fingerabdrücke (`ANDROID_SHA256` + `ANDROID_SHA256_PLAY`).

---

## iOS (Capacitor)

```bash
cd frontend && npm run build
npx cap sync ios
open ios/App/App.xcworkspace   # in Xcode bauen und einreichen
```

Capacitor-Konfiguration (`capacitor.config.json`):
- `StatusBar.overlaysWebView: true` — Safe-Area-Insets funktionieren korrekt
- `Keyboard.resize: body` + `resizeOnFullScreen: true`
- Android: `backgroundColor` + `captureInput` gesetzt

---

## Lizenz

ISC
