# 1 Landing Page
* Filtern geht nicht. Zeitfilter! 
* Ganztages Gruppen!
* Suchen und Buttons sollten nicht oben kleben bleiben.
* Bar zum Gruppen/Clubs erstellen ganz unten
* Nach Klick aiuf Hauptkategorien -> nur Unterkategorien werden angezeigt. 
* Strich unter Gruppen bisschen zu lang, Hintergrund des buttons genau gleich wie normaler Hintergrund
* Plus button bei gruppen dezenter
* Winkel der aüßeren umrandung bei gruppen anders als bei innerem 
* Weniger animationen, rote umrandung & hüpfen weg! Umrandung innen bisschen heller als äußere umrandung.
* Datum direkt in der rechten ecke, nicht überlappend mit Schrift
* Drücken auf Plus führt zu Gruppenbeschreibung
* Linie als Unterteiler zwischen Kategorien und gruppen weg
* Cascasde-Schrift weg und auslaufen lassen
* Bilder eine Ecke rund und kein Abstand zwischen den Bildern. 
* Karte Google Maps!!!


# 1.2 Gruppendetail
* Header oben sollte nicht stehen bleiben!




# 2 Entdecken Page
* Pro Feature über die ganze Seite.

# 3 Profil
* Favoriten auf Profil unter Freunde & Anfragen, gleicher Style! 
* Freund anfragen soll dieses Profil anzeigen


# 4 Clubs
* Selbes Design wie gruppen, nur breiter 
* Über im Trend -> Meine Clubs



# Einstellungen Symbol Zahnrad!!

# Passwort vergessen!!!

# Account löschen über Ausloggen und Account löschen kleiner! 

# Zu viele Anfragen bei dreifachem einloggen! 

# Alle Boosts und was nicht zum Vereinsschema passt weg!!

# Design & Schrift sichtbarer!!



/// 11.05.2026

Gruppenfotos auf Homepage rund an den Ecken!

Abstand zwischen Jmaie und Headern bisschen größer, mitte zwischen letztem (zu viel abstand) und jetzt (zu wenig abstand)

Jamie Überschrift und Header gehen beim runterscrollen nicht mit (nur gruppen am bildschirm!!)

Wenn man eine Kategorie auswählt, kommt man zu dne unterkategorien, "<-Alle" weg und überkategorie als ersten button, der bei nochmaligem klicken wieder auf überkategorien zurückgeht.

bei Klick auf zurücksetzen automatische zurücksetzung, kein klick auf anwenden nötig!

Kategorien in Filter???

Datumsanzeige nicht über Schrift/Gruppenüberschrift

Kreise zu Gruppenbeitreten an Design anpassen!

Stern neben teilen weg, nut herz onben rechts zu favoriten hinzufügen!

Clubs: Keine clubmitgliederfotos, sondern ein foto was clubersteller hochlädt

Meine Clubs an Design anpassen

Clubgründer kann einstellen ob bei chat alle reinschreiben können oder nur er/sie

Deine Chats? Ein Wort!! "Freunde" und Pro-Feature dafür weg

orangene balken unter überschriften zentrierter und immer gleich groß unter der überschrift (gleich groß wie diese)

Spacing zwischen Header und "Von dir erstellt" und "andere" ein Pixel größer und fett. 7

Favoriten auf Profil design, layout und anpassung!

Emojis? ganz oder gar nicht!




API KEYS>
API Key Checklist — Set these in Railway before going live
REQUIRED — App won't start or will crash without these
 DATABASE_URL — PostgreSQL connection string. Railway provides this automatically when you add a Postgres plugin. Copy from: Railway → Postgres → Connect → DATABASE_URL

 JWT_SECRET — min 32 random chars. Generate: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"

 SESSION_SECRET — min 32 random chars. Same command as above, run again for a different value.

 RESEND_API_KEY — transactional emails (OTP, password reset, verification). Sign up at resend.com → API Keys → Create. Also verify your sender domain in Resend or all emails will be rejected.

 EMAIL_FROM — e.g. JAMIE <noreply@yourdomain.com> — must use the verified domain from Resend.

 FRONTEND_URL — your public frontend URL, e.g. https://getjamie.app — used for CORS and email links. Comma-separate if you have multiple (Vercel preview + custom domain).

REQUIRED for specific features
 VITE_GOOGLE_MAPS_API_KEY (frontend build var) — required for the Karte/map tab. Google Cloud Console → APIs & Services → Enable "Maps JavaScript API" → Create credentials → API key. Restrict it to your domain via HTTP Referrers.

 GOOGLE_CLIENT_ID — required for secure Google login. Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client IDs. Add your frontend domain as Authorized JavaScript Origin.

 SPOTIFY_CLIENT_ID + SPOTIFY_CLIENT_SECRET — developer.spotify.com → Your App → Settings. Set redirect URI to https://yourfrontend.com/spotify/callback. Rotate — the old ID was committed to git.

 STRIPE_SECRET_KEY + STRIPE_PUBLISHABLE_KEY — dashboard.stripe.com → Developers → API keys. Use live keys for production.

 STRIPE_WEBHOOK_SECRET — for boost/one-time purchases. Stripe → Webhooks → Add endpoint https://yourbackend.com/api/boost/stripe/webhook → listen for payment_intent.succeeded → copy Signing Secret.

 STRIPE_SUBSCRIPTION_WEBHOOK_SECRET — separate endpoint for Pro subscriptions. Stripe → Webhooks → Add endpoint https://yourbackend.com/api/subscription/stripe/webhook → listen for customer.subscription.created/updated/deleted → copy Signing Secret.

 VITE_STRIPE_PUBLISHABLE_KEY (frontend build var) — same value as STRIPE_PUBLISHABLE_KEY above, but prefixed for Vite.

 PAYPAL_CLIENT_ID + PAYPAL_CLIENT_SECRET — developer.paypal.com → My Apps → Live credentials. Set PAYPAL_ENV=live.

 VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY — for web push notifications. Generate ONCE: npx web-push generate-vapid-keys. Store permanently — changing these breaks all existing push subscriptions.

 VITE_VAPID_PUBLIC_KEY (frontend build var) — same value as VAPID_PUBLIC_KEY.

 VAPID_SUBJECT — e.g. mailto:admin@yourdomain.com

 STORAGE_ENDPOINT + STORAGE_ACCESS_KEY + STORAGE_SECRET_KEY + STORAGE_PUBLIC_URL — Cloudflare R2 (or AWS S3) for image uploads. Without this, uploads fail in production.

RECOMMENDED (app works without them but is degraded)
 ADMIN_EMAIL — your email to receive content report notifications.

 SIGHTENGINE_API_USER + SIGHTENGINE_API_SECRET — image moderation. sightengine.com. Without it, uploaded images are not checked for nudity/gore.

 OPENAI_API_KEY — text moderation (uses free /v1/moderations endpoint, no cost). platform.openai.com/api-keys. Without it, text content is not moderated.

 SENTRY_DSN + VITE_SENTRY_DSN (frontend build var) — error monitoring. sentry.io → Create Project → Client Keys.

 REDIS_URL — Redis for rate limiting across multiple instances and Socket.IO scaling. Without it, both are single-instance only.

OPTIONAL / Later
 APPLE_TEAM_ID + APPLE_BUNDLE_ID — for iOS Universal Links (needed for App Store).

 ANDROID_SHA256 + ANDROID_SHA256_PLAY — for Android TWA asset links.

 VITE_GOOGLE_CLIENT_ID (frontend build var) — same as GOOGLE_CLIENT_ID, needed for the Google One Tap button to render.

One-time DB action for admin access
No env var needed. After deploying, run once:


UPDATE users SET is_admin=true WHERE email='your@email.com';