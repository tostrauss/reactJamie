# 📺 2 Minuten 2 Millionen — TV-Lastspitzen-Readiness

Stand: 2026-08-04 abends. JAMIE ist bei 2M2M angenommen (Video-Casting 05.08.,
Ausstrahlungstermin offen). Eine Ausstrahlung = tausende gleichzeitige
Erstbesucher in ~30 Minuten, großteils Mobilfunk (**Carrier-NAT**: viele
Nutzer teilen sich eine IPv4). Dieses Dokument ist Checkliste + Stand.

---

## ✅ Heute Nacht erledigt (Code, wartet auf Push/Deploy)

| Was | Warum |
|---|---|
| General-API-Limiter per-User statt per-IP (`0690dac`) | 100 Zuschauer im selben Netz haben je ihr eigenes Budget |
| Signup-Pfade (`/send-email-code`, `/verify-email-code`, `/register`) vom Login-Limiter entkoppelt | Registrierungs-Ansturm kann Logins nicht mehr aushungern — und umgekehrt |
| `registrationLimiter` 200 → **600/h pro IP** | ~150–200 komplette Signups/h **pro NAT-IP** (vorher ~50) |
| **Per-E-Mail-Drossel** beim OTP-Versand: 60s Cooldown + max 6 Codes/h (in-DB, replika-sicher) | Übernimmt die Anti-Abuse-Last (Mail-Bombing-Schutz), IP-unabhängig |
| Resend-Versand: 1× Retry bei 429/5xx (~800ms Backoff) | Provider-Sekundenlimit im Burst ⇒ kein sofortiges „E-Mail konnte nicht gesendet werden" mehr |
| Load-Sim-Skript `backend/scripts/loadtest-signup.js` | Voller Funnel, alle Nutzer über EINE IP = NAT-Worst-Case; nur gegen Dev/Staging |

## 📋 Morgen (05.08.) — Tobi + Tina in Railway

1. **Railway Pro upgraden.**
2. **Postgres → Backups-Reiter → Managed Backups aktivieren** (war Free-gesperrt).
3. **Redis-Service anlegen** (Projekt → + New → Database → Redis) und im
   Backend-Service **`REDIS_URL`** auf dessen URL setzen. Ohne Redis: nur
   1 Replika fahren! (Socket.IO-Adapter + Rate-Limit-Store sind sonst
   instanz-lokal — Code ist vorbereitet, aktiviert sich über die Env-Var.)
4. **APNs-Push:** `APNS_KEY_ID`, `APNS_TEAM_ID`=`3FMA7660T8`, `APNS_KEY`
   (.p8-Inhalt, `\n`-escaped), `APNS_BUNDLE_ID`=`com.jamie-app.app`.
5. **Resend-Plan prüfen** (resend.com → Settings/Usage): Welcher Plan, wie
   viele **Requests/Sekunde** und **E-Mails/Monat**? Free = 100 Mails/Tag →
   für TV **völlig unbrauchbar**; auch bezahlte Pläne haben ein
   Sekunden-Limit (Standard oft 2 rps = 120 Signups/min Obergrenze!).
   Ggf. Upgrade + Support-Ticket für höheres Burst-Limit VOR Ausstrahlung.

## 🔴 Offen vor der Ausstrahlung (sobald Termin bekannt)

- [ ] **Push + Deploy** (wartet auf Chat-Freigabe) — erst danach gelten die
      Funnel-Fixes live; danach Backup-`ARMED`-Check + Testlauf + Restore-Drill.
- [ ] **Load-Sim gegen Staging/lokal fahren**: `USERS=200 RAMP_SECONDS=60` —
      Ziel: 0 Rate-Limit-Fehler, p95 < 2s. (Braucht lokale DB oder
      Wegwerf-Railway-Postgres + Dev-Mode-Server.)
- [ ] **Replika-/Pool-Mathe festzurren**: `DB_POOL_MAX` (default prod 50) ×
      Replikas **< max_connections** der Railway-Postgres (~100): bei
      2 Replikas `DB_POOL_MAX=40`, bei 3 → 30.
- [ ] **Geräte-Realtest** am Ausstrahlungstag-Setup (TWA + iOS + Web).
- [ ] **Ausstrahlungstag-Runbook**: 1h vorher Replikas hoch + Sentry offen +
      `/admin` Wachstum als Live-Monitor; Boost/Deals-Cron-Spam prüfen;
      danach Retro. (Wird konkretisiert, sobald der Termin steht.)

## Warum die Funnel-Zahlen so gewählt sind

Ein kompletter Signup = 3–4 Auth-Calls (Code anfordern, verifizieren,
registrieren). Vorher: `authLimiter` 100/15min/IP war der Flaschenhals →
**~25–33 Signups pro 15 min pro NAT-IP**, danach „Zu viele Login-Versuche"
für ALLE hinter der IP (auch Bestandsnutzer!). Jetzt: Signups laufen am
Login-Budget vorbei, 600/h/IP Deckel, Missbrauch bremst die Per-E-Mail-Ebene
(6 Codes/h/Adresse + 5 Verify-Versuche/Code in der DB — hält über Replikas
und schützt Opfer-Postfächer unabhängig von Angreifer-IPs).





## Chat Feature (Tobi-Feedback nach Lokal-Test 05.08.) — ✅ beides erledigt
- ~~GRUPPE/CLUB-Badges weg → Avatar-Ring~~ ✅ umgesetzt: Coral-Ring = Gruppe,
  Lila-Ring = Club (Chat-Zeilen, Ausgeblendet, Verwalten); Text-Chip bleibt nur
  im Anfragen-Deck (dort zeigt das Foto den Anfragenden, nicht den Club).
- ~~Check: Beitritt ohne Profilbild bei privaten Gruppen/Clubs~~ ✅ bereits
  dicht: Avatar-Gate sitzt in joinGroup/joinClub VOR der Private-Verzweigung —
  gilt für öffentliche Joins UND private Anfragen (403 requiresAvatar →
  AvatarGateModal). Einzige bewusste Ausnahme: direkte Owner-Einladungen.



## Dashboard + iOS-Build (Tobi 05.08.) — Stand
- ~~Statistik „woher die User sind"~~ ✅ gebaut: `GET /admin/user-origins`
  (Länder aus `users.country` + Top-12-Städte aus der Profil-Location) +
  neuer Block im Admin-Wachstum: Flaggen, Balken, Prozent — auch für den
  2M2M-Pitch zitierfähig.
- ~~Stripe für den iOS-Build deaktivieren~~ ✅ war für KAUF-Flächen schon
  dicht (`purchasesEnabled()` = nur echter Browser; iOS zeigt weder Stripe
  noch „Bald verfügbar"). NEU zusätzlich abgedreht: die **Pro-LOCKS** öffnen
  auf nativem iOS nichts mehr (Apple 3.1.1 — kein Bewerben eines nicht
  kaufbaren Abos): ProModal-Event wird auf iOS ignoriert + Lock-Kacheln/
  Banner ausgeblendet (GroupCard, GroupDetail-Fotogitter & Members-Teaser,
  ClubDetail, ClubMembers). Web/Android unverändert.
- **Push Notifications aktiv** = die 4 `APNS_*`-Railway-Vars (Punkt 4 der
  Morgen-Checkliste oben) — Code-seitig ist alles da (`useNativePush`
  registriert beim App-Start, Web-Push läuft). Nach dem Setzen: App starten,
  Log-Zeile „iOS push DISABLED" darf NICHT mehr erscheinen.