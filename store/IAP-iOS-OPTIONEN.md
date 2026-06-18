# iOS In-App-Käufe — Ist-Zustand & Optionen

**Frage:** Boosts & JAMIE Pro lassen sich auf dem iPhone nicht kaufen. Was tun
vor dem iOS-Launch? Echtes IAP bauen oder die Bezahl-Features auf iOS ausblenden?

**TL;DR / Empfehlung:** Für die **erste iOS-Version Option B** (Bezahl-Features
auf iOS sauber ausblenden) — klein, risikoarm, sofort testbar, blockt den Launch
nicht. **Danach Option A mit RevenueCat** nachziehen. Begründung unten.

> ✅ **Status 2026-06-18: Option B ist umgesetzt.** Schalter
> `IOS_IAP_ENABLED = false` in [frontend/src/utils/platform.js](../frontend/src/utils/platform.js).
> Auf iOS sind damit ausgeblendet: Boost-„Kaufen"-Tab, Pro-Kauf-CTA, „Käufe
> wiederherstellen" (Settings + ProModal), Profil-Pro-CTA. Web & Android
> unverändert (Stripe). Sobald Option A gebaut/getestet ist → `= true` setzen.

---

## 1. Was aktuell wirklich passiert

Auf iPhone ist der Kauf **an beiden Enden kaputt**:

**Frontend** ([frontend/src/utils/iap.js](../frontend/src/utils/iap.js)):
- `iap.js` importiert dynamisch das Plugin `@capacitor-community/in-app-purchases`.
- Dieses Paket **gibt es nicht auf npm**. Es ist in
  [vite.config.js:51](../frontend/vite.config.js#L51) als `external` markiert,
  damit der Build durchläuft.
- Zur Laufzeit wirft `getPlugin()` deshalb „IAP plugin not installed". Heißt:
  Tippt ein iPhone-Nutzer auf „Kaufen", kommt **ein Fehler** — sowohl bei Boosts
  ([BoostModal.jsx:343](../frontend/src/components/BoostModal.jsx#L343)) als auch
  bei Pro ([ProModal.jsx:293](../frontend/src/components/ProModal.jsx#L293)).

**Backend** ([backend/src/controllers/iapController.js](../backend/src/controllers/iapController.js)):
- Die Library `@apple/app-store-server-library` **ist** installiert (gut).
- ABER `loadAppleRootCAs()` ([Zeile 76](../backend/src/controllers/iapController.js#L76))
  greift auf `lib.AppleRootCertificate.G3/G2/G1` zu — **die gibt es in der echten
  Library nicht**. Ergebnis: leere Zertifikatsliste → die Quittungs-Prüfung
  schlägt fehl. Selbst wenn das Frontend eine Quittung liefern würde, könnte der
  Server sie nicht verifizieren.
- Die Apple-Webhook-Route (`/apple/notifications`) ist in
  [iapRoutes.js](../backend/src/routes/iapRoutes.js) **nicht gemountet** (nur
  `verify` + `restore`).

→ **Fazit:** iOS-Käufe sind zu 100 % nicht funktionsfähig. So darf die App
**nicht** eingereicht werden — Apple lehnt sichtbare, aber kaputte Kauf-Buttons
ab (Guideline 2.1 / 3.1.1).

> Web & Android sind **nicht** betroffen — die laufen über Stripe und funktionieren.

---

## 2. Option A — Echtes IAP bauen

Apple verlangt für digitale Güter **StoreKit** (kein Stripe auf iOS). Zwei Wege:

### A1 — RevenueCat (empfohlen, falls A)
- Plugin `@revenuecat/purchases-capacitor` (existiert, ausgereift) ersetzt das
  Platzhalter-Plugin in `iap.js`.
- RevenueCat übernimmt Kauf, Wiederherstellen, Abos **und** die Quittungsprüfung.
  Unser Backend muss dann **nicht** mehr selbst gegen Apples Krypto verifizieren —
  es vertraut dem signierten **RevenueCat-Webhook** → der fehleranfällige
  `loadAppleRootCAs()`-Teil entfällt komplett.
- Aufwand: Plugin einbauen, RevenueCat-Projekt + Produkte anlegen, Webhook-Endpoint
  schreiben, testen.

### A2 — Direkt gegen Apple (vorhandenen Code fertig machen)
- Im Frontend ein echtes StoreKit-Plugin wählen (das aktuell referenzierte gibt es
  nicht).
- Im Backend `loadAppleRootCAs()` reparieren: die **echten** Apple-Root-Zertifikate
  von apple.com/certificateauthority laden und als `Buffer[]` an den Verifier geben;
  Webhook-Route mounten.
- Mehr eigener Krypto-Code = mehr Risiko als A1.

**Beide Wege brauchen zwingend:**
- ✋ **Apple-Developer-Account freigegeben** (noch nicht der Fall)
- App-Store-Connect-Kaufprodukte angelegt + „Ready to Submit"
- In-App-Purchase-Schlüssel (.p8), Sandbox-Testaccount
- **Test auf echtem Gerät/Simulator (Mac) im Sandbox-Modus** — IAP lässt sich
  nicht „blind" testen

**Aufwand:** mehrere Tage Entwicklung **+** Testen. **Frühestens startbar, wenn der
Apple-Account live ist.** **Risiko:** hoch (IAP-Reviews + Gerätetests).

---

## 3. Option B — Bezahl-Features auf iOS ausblenden (für v1)

Apple ist völlig in Ordnung mit einer App, die auf iOS **nichts** verkauft.
Abgelehnt wird nur: kaputte Kauf-Buttons oder Verweise auf externe Bezahlung.
Also blenden wir auf iOS alle Kauf-Einstiege **sauber** aus.

**Was Nutzer auf iPhone sehen:** die volle App — nur ohne „Boost kaufen" und ohne
„JAMIE Pro abonnieren". Wer bereits Pro ist (übers Web gekauft), **behält Pro**
(der Status kommt vom Server, unabhängig von der Plattform).

**Konkrete Änderungen (klein, alle hinter einem Schalter):**
- Einen Schalter `IOS_IAP_ENABLED = false` einführen (z. B. in `utils/platform.js`).
- Kauf-Einstiege nur zeigen, wenn `!isNativeIOS() || IOS_IAP_ENABLED`:
  - Boost kaufen: [BoostModal.jsx:343](../frontend/src/components/BoostModal.jsx#L343)
  - Boost-Einstieg auf Event-Seiten: [GroupDetail.jsx:86](../frontend/src/pages/GroupDetail.jsx#L86), [ClubDetail.jsx:48](../frontend/src/pages/ClubDetail.jsx#L48)
  - Pro abonnieren + „Käufe wiederherstellen": [ProModal.jsx:293/550/572](../frontend/src/components/ProModal.jsx#L293)
  - Pro-Verwaltung/Upsell in den Einstellungen: [SettingsPage.jsx:491/511](../frontend/src/pages/SettingsPage.jsx#L491)
- `iap.js` bleibt als ruhendes Gerüst liegen (wird nie aufgerufen, weil die Buttons
  weg sind) — für Option A später.

**Aufwand:** ~½ Tag, **komplett am Web/im Browser testbar, kein Mac/Apple-Account
nötig.** **Risiko:** gering. **Umsatz:** kein iOS-Umsatz beim Launch (Web + Android
verdienen über Stripe weiter).

**Später aktivieren:** Wenn Option A gebaut ist, `IOS_IAP_ENABLED = true` setzen —
die Kauf-Logik ist ja schon plattformabhängig verdrahtet.

---

## 4. Empfehlung

| | Option B (jetzt) | Option A (später) |
|---|---|---|
| Blockt iOS-Launch? | **Nein** | Ja (wartet auf Apple-Account) |
| Aufwand | ½ Tag | mehrere Tage + Tests |
| Risiko | gering | hoch |
| Jetzt testbar? | **ja** (Web) | nein (braucht Sandbox/Mac) |
| iOS-Umsatz | — | ja |

**→ Reihenfolge:** **Jetzt Option B**, damit die iOS-Einreichung nicht hängt.
**Dann Option A via RevenueCat**, sobald der Apple-Account live ist und Tina
Sandbox-Tests am Mac machen kann. RevenueCat spart uns dabei den fehleranfälligen
eigenen Apple-Krypto-Code (der heutige `loadAppleRootCAs()`-Bug).

> Wichtig: Web & Android bleiben in **beiden** Optionen unverändert bei Stripe.
