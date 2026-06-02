import { Link } from 'react-router-dom';

export default function PrivacyPolicy() {
  return (
    <div className="page" style={{ padding: '24px 20px 80px', maxWidth: 700, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <Link to="/" style={{ color: 'var(--coral)', textDecoration: 'none', fontSize: 14 }}>
          ← Zurück
        </Link>
      </div>

      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Datenschutzerklärung</h1>
      <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 32 }}>
        Zuletzt aktualisiert: Mai 2026
      </p>

      <Section title="1. Verantwortlicher">
        <p>
          Verantwortlich für die Verarbeitung deiner personenbezogenen Daten im Sinne der DSGVO ist
          der Betreiber der JAMIE-App. Bei Fragen wende dich an:{' '}
          <a href="mailto:privacy@jamie-app.com" style={{ color: 'var(--coral)' }}>
            privacy@jamie-app.com
          </a>
        </p>
      </Section>

      <Section title="2. Welche Daten wir erheben">
        <ul>
          <li><strong>Kontodaten:</strong> Name, E-Mail-Adresse, Passwort (verschlüsselt)</li>
          <li><strong>Profildaten:</strong> Profilbild, Biografie, Standort, Interessen, Alter</li>
          <li><strong>Inhaltsdaten:</strong> Nachrichten, erstellte Gruppen und Clubs</li>
          <li><strong>Spotify-Daten:</strong> Nur wenn du Spotify verbindest: deine Top-Tracks und
            zuletzt gehörte Songs (nur lesend, wir speichern keine Musik-Inhalte)</li>
          <li><strong>Gerätedaten:</strong> IP-Adresse, Browser-Typ (für Sicherheit und
            Fehlerdiagnose)</li>
        </ul>
      </Section>

      <Section title="3. Zweck der Datenverarbeitung">
        <ul>
          <li>Bereitstellung und Betrieb der App (Art. 6 Abs. 1 lit. b DSGVO)</li>
          <li>Authentifizierung und Kontosicherheit</li>
          <li>Anzeige von Gruppen, Clubs und Profilen anderen Nutzern gegenüber</li>
          <li>Versand von Passwort-Reset- und Verifizierungs-E-Mails</li>
          <li>Echtzeit-Chat innerhalb von Gruppen</li>
        </ul>
      </Section>

      <Section title="4. Weitergabe an Dritte">
        <p>Wir geben deine Daten nicht an Dritte weiter, außer:</p>
        <ul>
          <li><strong>Spotify:</strong> Wenn du Spotify verbindest, werden OAuth-Tokens sicher
            gespeichert und nur für deine Spotify-Anfragen verwendet.</li>
          <li><strong>Sightengine (Frankreich):</strong> Hochgeladene Bilder werden zur
            automatischen Prüfung auf unzulässige Inhalte (Moderation) an Sightengine übermittelt.
            Datenschutz: sightengine.com/privacy</li>
          <li><strong>OpenAI, Inc. (USA):</strong> Textnachrichten werden zur automatischen
            Inhaltsmoderation an die OpenAI Moderation API übermittelt. Es werden keine
            Nachrichten gespeichert oder für das Training von Modellen verwendet.
            Datenschutz: openai.com/privacy</li>
          <li><strong>Hosting-Anbieter:</strong> Unsere Server laufen bei Railway (USA). Die
            Datenübertragung erfolgt nach Art. 46 DSGVO mit Standardvertragsklauseln.</li>
          <li><strong>Gesetzliche Pflichten:</strong> Bei berechtigten behördlichen Anfragen.</li>
        </ul>
      </Section>

      <Section title="5. Einsatz von KI und automatisierte Entscheidungen">
        <p>
          JAMIE setzt KI-gestützte Systeme zur Inhaltsmoderation ein (Risikoklasse „minimales
          Risiko" gemäß EU AI Act, Verordnung (EU) 2024/1689):
        </p>
        <ul>
          <li>
            <strong>Bildmoderation (Sightengine):</strong> Jedes hochgeladene Bild wird
            automatisch auf Nacktheit und Gewaltdarstellungen geprüft. Auffällige Bilder
            werden abgelehnt, bevor sie gespeichert werden.
          </li>
          <li>
            <strong>Textmoderation (OpenAI Moderation API):</strong> Nachrichten im
            Gruppen-Chat und bei Direktnachrichten werden automatisch auf Hassrede,
            Belästigung, bedrohende oder sexuelle Inhalte geprüft. Auffällige Nachrichten
            werden blockiert.
          </li>
        </ul>
        <p>
          Diese Prüfungen laufen vollautomatisch. Wenn du der Meinung bist, dass ein Inhalt
          zu Unrecht blockiert wurde, kannst du dich jederzeit an{' '}
          <a href="mailto:privacy@jamie-app.com" style={{ color: 'var(--coral)' }}>
            privacy@jamie-app.com
          </a>{' '}
          wenden (Widerspruchsrecht gem. Art. 22 DSGVO).
        </p>
      </Section>

      <Section title="6. Speicherdauer">
        <p>
          Deine Daten werden gespeichert, solange dein Konto aktiv ist. Du kannst dein Konto
          jederzeit in <strong>Einstellungen → Konto löschen</strong> dauerhaft löschen. Dabei
          werden alle deine Nachrichten, Profilbilder und persönlichen Daten entfernt.
        </p>
      </Section>

      <Section title="7. Deine Rechte">
        <ul>
          <li><strong>Auskunft</strong> über gespeicherte Daten (Art. 15 DSGVO)</li>
          <li><strong>Berichtigung</strong> falscher Daten (Art. 16 DSGVO)</li>
          <li><strong>Löschung</strong> deiner Daten (Art. 17 DSGVO)</li>
          <li><strong>Einschränkung</strong> der Verarbeitung (Art. 18 DSGVO)</li>
          <li><strong>Datenübertragbarkeit</strong> (Art. 20 DSGVO)</li>
          <li><strong>Widerspruch</strong> gegen die Verarbeitung (Art. 21 DSGVO)</li>
        </ul>
        <p>
          Zur Ausübung deiner Rechte wende dich an{' '}
          <a href="mailto:privacy@jamie-app.com" style={{ color: 'var(--coral)' }}>
            privacy@jamie-app.com
          </a>
          . Du hast außerdem das Recht, dich bei der zuständigen Datenschutzbehörde zu beschweren.
        </p>
      </Section>

      <Section title="8. Sicherheit">
        <p>
          Wir verwenden HTTPS-Verschlüsselung, bcrypt-Passwort-Hashing, JWT-Authentifizierung
          und Rate-Limiting zum Schutz deiner Daten. Passwörter werden niemals im Klartext
          gespeichert.
        </p>
      </Section>

      <Section title="9. Cookies und lokaler Speicher">
        <p>
          Wir verwenden keine Werbe-Cookies. Wir verwenden <code>localStorage</code> ausschließlich
          für dein Authentifizierungs-Token und App-Einstellungen (z. B. ob du das
          Installations-Banner geschlossen hast).
        </p>
      </Section>

      <Section title="10. Zahlungsdienstleister">
        <p>
          Wenn du Boost-Credits oder ein Pro-Abonnement kaufst, werden Zahlungen verarbeitet
          durch:
        </p>
        <ul>
          <li><strong>Stripe, Inc.</strong> (USA) — Datenschutz: stripe.com/privacy</li>
          <li><strong>PayPal Holdings, Inc.</strong> (USA) — Datenschutz: paypal.com/privacy</li>
          <li><strong>Apple In-App Purchase</strong> (auf iOS) — apple.com/privacy</li>
          <li><strong>Google Play Billing</strong> (auf Android) — policies.google.com/privacy</li>
        </ul>
        <p>
          Wir speichern keine vollständigen Zahlungsdaten. Alle Transaktionen werden ausschließlich
          von den jeweiligen Zahlungsdienstleistern verarbeitet.
        </p>
      </Section>

      <Section title="11. Minderjährige">
        <p>
          JAMIE richtet sich ausschließlich an Personen ab <strong>18 Jahren</strong>. Wir erheben
          wissentlich keine Daten von Personen unter 18 Jahren.
        </p>
      </Section>

      <Section title="12. Änderungen dieser Datenschutzerklärung">
        <p>
          Wir können diese Erklärung gelegentlich aktualisieren. Bei wesentlichen Änderungen
          informieren wir dich per E-Mail oder In-App-Benachrichtigung. Das Datum der letzten
          Aktualisierung steht immer oben auf dieser Seite.
        </p>
      </Section>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section style={{ marginBottom: 28 }}>
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 10, color: 'var(--text-primary)' }}>
        {title}
      </h2>
      <div style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
        {children}
      </div>
    </section>
  );
}
