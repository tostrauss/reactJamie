# JAMIE — QR-Codes

QR-Codes, die zur App führen. Erstellt 2026-06-20.

**Kodierte URL:** `https://app.jamie-app.com`
(= die Web-/PWA-Version. Auf iOS Safari → „Zum Home-Bildschirm“, auf Android Chrome
erscheint der Installieren-Banner. Native App-Store-Links folgen, sobald veröffentlicht.)

## Dateien
| Datei | Zweck |
|------|-------|
| `jamie-app-qr.png` | Markenfarbe (Dunkelviolett `#231B43`), 1024 px — für Web, Social, Druck |
| `jamie-app-qr.svg` | Vektor — **für Print** beliebig skalierbar (Plakat, Flyer, Sticker) |
| `jamie-app-qr-black.png` | Reines Schwarz/Weiß — maximale Scan-Sicherheit (z. B. schlechte Drucker) |

Fehlerkorrektur: **H** (höchste) — verträgt Verschmutzung/Logo-Overlay.

## Neu erzeugen (z. B. andere URL oder mit Tracking)
```bash
# Standard (Markenfarbe, PNG 1024px)
npx -y qrcode -e H -t png -w 1024 -d 231B43FF -l FFFFFFFF -o marketing/jamie-app-qr.png "https://app.jamie-app.com"

# Vektor fürs Plakat
npx -y qrcode -e H -t svg -d 231B43FF -l FFFFFFFF -o marketing/jamie-app-qr.svg "https://app.jamie-app.com"

# Mit Scan-Tracking (UTM) — zählt Aufrufe in der Analytics
npx -y qrcode -e H -t png -w 1024 -d 231B43FF -l FFFFFFFF -o marketing/jamie-app-qr-flyer.png "https://app.jamie-app.com/?utm_source=qr&utm_medium=flyer"
```

## Druck-Tipps
- **Mindestgröße ~2 × 2 cm** auf Papier; mehr ist besser (Plakat ≥ 5 cm).
- Den weißen Rand (Quiet Zone) **nicht** wegschneiden — sonst scannt er schlecht.
- Vor dem Druck **mit mehreren Handys testen** (iPhone-Kamera + Android).
- Für Print immer die **SVG** verwenden (gestochen scharf in jeder Größe).
