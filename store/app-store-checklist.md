# App Store & Google Play — Submission Checklist

## Required Screenshot Sizes

### Apple App Store (all required)
| Device | Size | Simulator |
|---|---|---|
| iPhone 6.9" (required) | 1320 × 2868 px | iPhone 16 Pro Max |
| iPhone 6.5" (required) | 1284 × 2778 px | iPhone 14 Plus / 15 Plus |
| iPhone 5.5" (required) | 1242 × 2208 px | iPhone 8 Plus |
| iPad Pro 13" (if iPad) | 2064 × 2752 px | iPad Pro 13-inch |

Minimum 3, maximum 10 screenshots per device class.

### Google Play Store
| Type | Size |
|---|---|
| Phone screenshots (min 2) | 1080 × 1920 px (portrait) |
| Feature graphic (required) | 1024 × 500 px |
| App icon | 512 × 512 px |

---

## How to Take Screenshots (iOS Simulator)

1. Run the app: `cd ios && ./1-init.sh` then `./2-open-xcode.sh`
2. In Xcode → open Simulator for each required device size
3. Navigate to each screen you want to screenshot
4. Press `Cmd + S` in Simulator to save screenshot to Desktop
5. Rename files descriptively: `01-home.png`, `02-explore.png`, etc.

## Suggested Screens to Screenshot
- [ ] Home / Activity Feed
- [ ] Explore / Map view
- [ ] Group detail page
- [ ] Chat / messaging
- [ ] User profile

---

## App Store Connect Metadata (German)

**Name:** JAMIE – Social Activity App  
**Subtitle:** Finde Leute für Aktivitäten  
**Category:** Social Networking  
**Secondary Category:** Lifestyle

**Description (DE):**
```
JAMIE ist deine neue Social-App für Aktivitäten in deiner Stadt.

Erstelle oder tritt Gruppen für Sport, Kultur, Ausgehen und mehr bei. 
Chatte in Echtzeit, finde neue Freunde und entdecke lokale Events.

✦ Gruppen erstellen oder beitreten
✦ Echtzeit-Chat mit deiner Gruppe  
✦ Clubs für regelmäßige Aktivitäten
✦ Interaktive Karte für Events in deiner Nähe
✦ Profil mit deinem Lieblingssong
✦ Trusted User Badge für verlässliche Mitglieder
```

**Keywords (max 100 chars):**
```
sozial,gruppen,aktivitäten,sport,ausgehen,events,freunde,chat,clubs,wien
```

**Support URL:** https://reactjamie-production.up.railway.app/privacy  
**Privacy Policy URL:** https://reactjamie-production.up.railway.app/privacy  
**Marketing URL:** https://reactjamie-production.up.railway.app

---

## Google Play Store Metadata (German)

**Kurzbeschreibung (max 80 chars):**
```
Finde Leute für Aktivitäten und tritt lokalen Gruppen bei
```

**Vollständige Beschreibung (max 4000 chars):**
```
JAMIE verbindet Menschen über gemeinsame Aktivitäten.

📍 LOKALE GRUPPEN ENTDECKEN
Finde Gruppen für Sport, Ausgehen, Kultur und mehr – direkt in deiner Nähe auf der interaktiven Karte.

💬 ECHTZEIT-CHAT
Chatte sofort mit deiner Gruppe. Keine Verzögerungen, kein Warten.

🏆 TRUSTED USER BADGE
Verlässliche Mitglieder werden mit einem verifizierten Badge ausgezeichnet.

🎵 PERSÖNLICHES PROFIL
Zeige deinen Lieblingssong, deine Interessen und Fotos.

✨ CLUBS FÜR REGELMÄSSIGE TREFFEN
Gründe oder trete Clubs für wöchentliche Aktivitäten bei.
```

**Content Rating:** Everyone (keine Gewalt, keine sexuellen Inhalte)  
**Category:** Social

---

## Apple Review Test Account
Create a test account before submission:
- Email: review@jamie-test.com (use a real email you control)
- Password: [create one meeting your policy]
- Pre-fill the profile (name, bio, photo, interests)
- Join at least one group so reviewers can see the feature

Add these credentials in App Store Connect → App Review Information.

---

## Data Safety Form (Google Play — required)

| Question | Answer |
|---|---|
| Does your app collect user data? | Yes |
| Location data | Approximate (for map features) |
| Personal info | Name, email, photos |
| In-app purchases | Yes (Stripe boost credits) |
| Data encrypted in transit | Yes |
| Users can request deletion | Yes (Settings → Konto löschen) |
