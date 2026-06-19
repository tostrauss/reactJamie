# Widerrufsbelehrung — VORLAGE (Entwurf)

> ⚠️ **KEINE RECHTSBERATUNG.** Dies ist ein Entwurf/Platzhalter, damit die App
> technisch vorbereitet werden kann. **Vor Veröffentlichung muss eine
> Rechtsanwältin/ein Rechtsanwalt oder die WKO den Text prüfen und freigeben.**
> Grundlage: österr. **FAGG** (Fern- und Auswärtsgeschäfte-Gesetz), Umsetzung der
> EU-Verbraucherrechte-Richtlinie 2011/83/EU. Stand: 2026-06-19.

Unternehmerdaten sind bereits aus dem Impressum eingesetzt:
**IMPIBAG e.U.**, Witthauergasse 6/1, 1180 Wien, Österreich · office@jamie-app.com ·
FN 670339v (HG Wien) · UID ATU82812645. Inhaberin: Tina Glavanovitz.

---

## ⬛ ZUERST ENTSCHEIDEN (eine juristische Grundsatzfrage)

JAMIE Pro ist eine **laufende digitale Dienstleistung**. Beim Widerrufsrecht gibt
es dafür zwei Wege — die Anwältin muss einen wählen, weil davon abhängt, was der
„Widerruf-Button“ technisch tun soll (voller Refund vs. anteilig vs. keiner):

- **Variante A — Widerruf wird gewährt (verbraucherfreundlich, empfohlen für Start).**
  Nutzer:innen können 14 Tage lang widerrufen. Haben sie ausdrücklich verlangt,
  dass die Leistung sofort beginnt, zahlen sie nur den **anteiligen** Betrag für
  die bis zum Widerruf genutzte Zeit (§ 16 FAGG); der Rest wird rückerstattet.
- **Variante B — vorzeitiges Erlöschen (§ 18 FAGG).** Beim Kauf bestätigt der/die
  Nutzer:in ausdrücklich den sofortigen Leistungsbeginn **und** den Verlust des
  Widerrufsrechts. Dann besteht (nach vollständiger bzw. begonnener Erbringung)
  **kein** Widerrufsrecht mehr → kein Refund. Erfordert eine Checkbox im Kauf-Flow
  (Text unten) und ist bei Einstufung als „digitaler Inhalt“ heikler.

> 👉 **Offene Entscheidung für Tina + Anwältin: A oder B?**
> Empfehlung fürs erste Release: **Variante A** (einfach, sauber, kulanzfreundlich;
> bei einem 4,99 €–14,99 € Abo ist das anteilige/volle Refund-Risiko gering).

> ✅ **ENTSCHIEDEN & GEBAUT (2026-06-19): Variante A.** Mit **voller Rückerstattung**
> (mehr als das § 16-Minimum — immer rechtskonform, kein Streit ums Anteilige).
> Technisch fertig + getestet (siehe Abschnitt 4). **Offen bleibt nur:** den
> Belehrungstext (Abschnitt 1 + 2, jetzt auch live unter `/widerruf`) von der
> Anwältin/WKO prüfen lassen. Funktioniert nur für Stripe-Abos (Web/Android);
> Apple-Abos verweisen auf den App Store.

---

## 1) Widerrufsbelehrung (Text für /widerruf + AGB)

**Widerrufsrecht**

Sie haben das Recht, binnen vierzehn Tagen ohne Angabe von Gründen diesen Vertrag
zu widerrufen. Die Widerrufsfrist beträgt vierzehn Tage ab dem Tag des
Vertragsabschlusses (Abschluss des Pro-Abonnements).

Um Ihr Widerrufsrecht auszuüben, müssen Sie uns

> IMPIBAG e.U.
> Witthauergasse 6/1, 1180 Wien, Österreich
> E-Mail: office@jamie-app.com

mittels einer eindeutigen Erklärung (z. B. ein mit der Post versandter Brief oder
eine E-Mail) über Ihren Entschluss, diesen Vertrag zu widerrufen, informieren. Sie
können dafür das beigefügte Muster-Widerrufsformular verwenden, das jedoch nicht
vorgeschrieben ist. In der App können Sie den Widerruf außerdem direkt über die
Schaltfläche **„Widerruf erklären“** (Einstellungen → Abonnement) ausüben.

Zur Wahrung der Widerrufsfrist reicht es aus, dass Sie die Mitteilung über die
Ausübung des Widerrufsrechts vor Ablauf der Widerrufsfrist absenden.

**Folgen des Widerrufs**

Wenn Sie diesen Vertrag widerrufen, haben wir Ihnen alle Zahlungen, die wir von
Ihnen erhalten haben, unverzüglich und spätestens binnen vierzehn Tagen ab dem Tag
zurückzuzahlen, an dem die Mitteilung über Ihren Widerruf dieses Vertrags bei uns
eingegangen ist. Für diese Rückzahlung verwenden wir dasselbe Zahlungsmittel, das
Sie bei der ursprünglichen Transaktion eingesetzt haben, es sei denn, mit Ihnen
wurde ausdrücklich etwas anderes vereinbart; in keinem Fall werden Ihnen wegen
dieser Rückzahlung Entgelte berechnet.

*(nur für Variante A relevant:)* Haben Sie verlangt, dass die Dienstleistung
während der Widerrufsfrist beginnen soll, so haben Sie uns einen angemessenen
Betrag zu zahlen, der dem Anteil der bis zum Zeitpunkt Ihres Widerrufs bereits
erbrachten Dienstleistungen im Vergleich zum Gesamtumfang der im Vertrag
vorgesehenen Dienstleistungen entspricht.

---

## 2) Muster-Widerrufsformular (gesetzliche Vorlage)

> Wenn Sie den Vertrag widerrufen wollen, füllen Sie bitte dieses Formular aus und
> senden es zurück.

```
An: IMPIBAG e.U., Witthauergasse 6/1, 1180 Wien, office@jamie-app.com

Hiermit widerrufe(n) ich/wir (*) den von mir/uns (*) abgeschlossenen Vertrag
über die Erbringung der folgenden Dienstleistung: JAMIE Pro-Abonnement

— Bestellt am (*) / erhalten am (*): _______________
— Name des/der Verbraucher(s):       _______________
— Anschrift des/der Verbraucher(s):  _______________
— Datum:                             _______________
— Unterschrift (nur bei Mitteilung auf Papier)

(*) Unzutreffendes streichen.
```

---

## 3) NUR für Variante B — Zustimmungstext im Kauf-Flow (ProModal)

Pflicht-Checkbox vor „Jetzt kaufen“ (sonst greift § 18 nicht):

> ☐ Ich stimme ausdrücklich zu, dass IMPIBAG e.U. mit der Erbringung der
> Pro-Leistungen sofort und vor Ablauf der 14-tägigen Widerrufsfrist beginnt. Mir
> ist bekannt, dass ich dadurch mein Widerrufsrecht verliere (bei digitalen
> Inhalten) bzw. bei vollständiger Vertragserfüllung verliere.

> ⚠️ Bei Variante B muss diese Zustimmung **protokolliert** werden (wer, wann) —
> sonst ist sie im Streitfall wertlos.

---

## 4) Technische Umsetzung in der App (sobald A oder B fixiert ist)

Alles unten ist **vorbereitet, aber noch NICHT gebaut** — wartet auf die
juristische Freigabe + die A/B-Entscheidung.

**Frontend**
- Neue Seite `/widerruf` (`WiderrufPage.jsx`): rendert Abschnitt 1 + 2.
  Verlinkt aus: Einstellungen → Rechtliches, AGB (`/terms`), und (bei Variante B)
  dem Kauf-Screen.
- Einstellungen → Abonnement: Button **„Widerruf erklären“**, sichtbar für
  Pro-Nutzer:innen, deren Abo **≤ 14 Tage** alt ist (`current_period_start`).
  - **MVP (heute machbar):** Button öffnet vorausgefüllte `mailto:`-Nachricht an
    office@jamie-app.com mit dem Muster-Widerrufsformular. E-Mail ist eine gültige
    „eindeutige Erklärung“ — rechtskonform, null Backend-Aufwand.
  - **Voll:** `POST /api/subscription/withdraw` → Backend kündigt Stripe-Abo
    sofort (`stripe.subscriptions.cancel`) + erstattet (`stripe.refunds.create`,
    voll oder anteilig je nach A) + bestätigt per E-Mail + protokolliert.

**Backend** (für die Vollvariante)
- `withdrawSubscription`-Controller in `subscriptionController.js`:
  Frist prüfen (≤14 Tage), Stripe sofort kündigen, Refund (A: anteilig/voll;
  B: keiner), `subscriptions.status = 'canceled'`, Bestätigungs-E-Mail.
- iOS: Apple-Abos laufen über das Apple-Refund-System (kein Stripe) → dort nur
  Hinweis „über App Store anfordern“ (analog zur bestehenden `managed_by:'apple'`-Logik).

**Aufwand:** MVP (mailto) ~30 Min. · Vollvariante ~halber Tag.

---

## 5) Checkliste für Tina

- [x] Entscheidung **Variante A** getroffen (2026-06-19)
- [x] Refund-Politik festgelegt: **volle Rückerstattung** innerhalb 14 Tage
- [x] Technisch eingebaut (Seite `/widerruf` + Button in Einstellungen + Backend-Refund)
- [ ] **Offen:** Anwältin/WKO prüft den Text in Abschnitt 1 + 2 (= Inhalt von `/widerruf`) und gibt ihn frei
- [ ] (Optional) Text auch in die AGB übernehmen

---

*Erstellt 2026-06-19 als Vorbereitung. Ersetzt keine anwaltliche Prüfung.*
