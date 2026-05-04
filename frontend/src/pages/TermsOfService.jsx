import { Link } from 'react-router-dom';

export default function TermsOfService() {
  return (
    <div className="page" style={{ padding: '24px 20px 80px', maxWidth: 700, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <Link to="/" style={{ color: 'var(--coral)', textDecoration: 'none', fontSize: 14 }}>
          ← Zurück
        </Link>
      </div>

      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Nutzungsbedingungen</h1>
      <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 32 }}>
        Zuletzt aktualisiert: Mai 2026
      </p>

      <Section title="1. Geltungsbereich">
        <p>
          Diese Nutzungsbedingungen regeln die Nutzung der JAMIE-App und der zugehörigen
          Dienste (gemeinsam „Dienst") durch dich. Durch die Registrierung oder Nutzung des
          Dienstes stimmst du diesen Bedingungen zu. Wenn du nicht einverstanden bist, nutze
          den Dienst bitte nicht.
        </p>
      </Section>

      <Section title="2. Betreiber">
        <p>
          Der Dienst wird betrieben von:<br />
          <strong>JAMIE</strong><br />
          Kontakt: <a href="mailto:legal@getjamie.app" style={{ color: 'var(--coral)' }}>legal@getjamie.app</a>
        </p>
      </Section>

      <Section title="3. Nutzungsvoraussetzungen">
        <ul>
          <li>Du musst mindestens <strong>18 Jahre</strong> alt sein, um JAMIE zu nutzen.</li>
          <li>Du musst bei der Registrierung wahrheitsgemäße Angaben machen.</li>
          <li>Ein Account ist persönlich und nicht übertragbar.</li>
          <li>Du bist für die Sicherheit deines Passworts selbst verantwortlich.</li>
          <li>Der Dienst ist derzeit nur in Österreich, Deutschland und der Schweiz verfügbar.</li>
        </ul>
      </Section>

      <Section title="4. Erlaubte und verbotene Nutzung">
        <p>Du darfst JAMIE nutzen, um:</p>
        <ul>
          <li>Gruppen und Clubs für soziale Aktivitäten zu erstellen und beizutreten.</li>
          <li>Mit anderen Nutzern zu chatten und Freundschaften zu pflegen.</li>
          <li>Veranstaltungen und Treffen zu organisieren.</li>
        </ul>
        <p>Ausdrücklich verboten ist:</p>
        <ul>
          <li>Belästigung, Mobbing, Bedrohung oder Diskriminierung anderer Nutzer.</li>
          <li>Verbreitung von rechtswidrigen, anstößigen oder pornografischen Inhalten.</li>
          <li>Spam, Werbung oder unerbetene Nachrichten.</li>
          <li>Verwendung von Bots, Scraping-Tools oder automatisierten Skripten.</li>
          <li>Erstellung von Fake-Profilen oder Identitätsbetrug.</li>
          <li>Nutzung des Dienstes für kommerzielle Zwecke ohne ausdrückliche Genehmigung.</li>
          <li>Umgehung von Sicherheitsmechanismen oder technische Angriffe auf den Dienst.</li>
        </ul>
      </Section>

      <Section title="5. Nutzerinhalte">
        <p>
          Du bist allein verantwortlich für die Inhalte, die du über JAMIE veröffentlichst
          (Profilbilder, Nachrichten, Gruppendetails usw.). Mit dem Hochladen räumst du JAMIE
          das nicht-exklusive, gebührenfreie Recht ein, diese Inhalte im Rahmen des Dienstes
          darzustellen und zu übermitteln. Wir beanspruchen kein Eigentum an deinen Inhalten.
        </p>
        <p>
          Inhalte, die gegen diese Bedingungen verstoßen, können ohne Vorankündigung entfernt
          werden.
        </p>
      </Section>

      <Section title="6. Moderation und Kontosperrung">
        <p>
          Wir behalten uns vor, Accounts zu sperren oder zu löschen, die gegen diese
          Bedingungen verstoßen — insbesondere bei Belästigung, gefälschten Profilen oder
          Verbreitung rechtswidriger Inhalte. Bei schwerwiegenden Verstößen behalten wir uns
          vor, entsprechende Behörden zu informieren.
        </p>
      </Section>

      <Section title="7. Käufe und Zahlungen (Boost-Credits)">
        <p>
          JAMIE bietet optionale kostenpflichtige Funktionen an („Boost-Credits"), mit denen
          du Gruppen oder Clubs vorübergehend hervorheben kannst. Es gelten folgende Regeln:
        </p>
        <ul>
          <li>Käufe sind endgültig und werden nicht erstattet, sofern gesetzlich nichts anderes vorgeschrieben ist.</li>
          <li>Credits verfallen nicht, sind aber nicht übertragbar.</li>
          <li>Zahlungen werden über Stripe oder PayPal abgewickelt; es gelten deren Nutzungsbedingungen.</li>
          <li>Auf iOS werden Käufe über das Apple In-App-Purchase-System (StoreKit) abgewickelt.</li>
          <li>Auf Android werden Käufe über Google Play Billing abgewickelt.</li>
          <li>Widerrufsrecht: Gemäß EU-Verbraucherrecht hast du ein 14-tägiges Widerrufsrecht, sofern du die Nutzung der Credits noch nicht begonnen hast.</li>
        </ul>
      </Section>

      <Section title="8. Pro-Abonnement">
        <p>
          Das JAMIE Pro-Abonnement verlängert sich automatisch monatlich, bis du es kündigst.
          Du kannst das Abonnement jederzeit in den Einstellungen kündigen. Die Kündigung wird
          zum Ende des aktuellen Abrechnungszeitraums wirksam.
        </p>
      </Section>

      <Section title="9. Haftungsausschluss">
        <p>
          Der Dienst wird „wie er ist" bereitgestellt. Wir übernehmen keine Garantie für
          ununterbrochene Verfügbarkeit oder Fehlerfreiheit. JAMIE ist eine Plattform zur
          Vermittlung von sozialen Aktivitäten — wir sind nicht verantwortlich für das
          tatsächliche Verhalten von Nutzern bei Treffen oder Veranstaltungen.
        </p>
        <p>
          Unsere Haftung ist auf Vorsatz und grobe Fahrlässigkeit beschränkt, soweit gesetzlich
          zulässig.
        </p>
      </Section>

      <Section title="10. Geistiges Eigentum">
        <p>
          Alle Rechte am JAMIE-Markenzeichen, Logo, Design und Code liegen beim Betreiber.
          Du erhältst eine beschränkte, nicht übertragbare Lizenz zur persönlichen, nicht
          kommerziellen Nutzung der App.
        </p>
      </Section>

      <Section title="11. Datenschutz">
        <p>
          Informationen zur Verarbeitung deiner personenbezogenen Daten findest du in unserer{' '}
          <Link to="/privacy" style={{ color: 'var(--coral)' }}>Datenschutzerklärung</Link>.
        </p>
      </Section>

      <Section title="12. Änderungen der Bedingungen">
        <p>
          Wir können diese Bedingungen jederzeit aktualisieren. Bei wesentlichen Änderungen
          informieren wir dich mindestens 14 Tage im Voraus per E-Mail oder
          In-App-Benachrichtigung. Die fortgesetzte Nutzung nach Inkrafttreten der Änderungen
          gilt als Zustimmung.
        </p>
      </Section>

      <Section title="13. Anwendbares Recht und Gerichtsstand">
        <p>
          Es gilt österreichisches Recht unter Ausschluss der Kollisionsnormen. Gerichtsstand
          für Streitigkeiten mit Unternehmern ist Wien, Österreich. Für Verbraucher gelten die
          gesetzlichen Zuständigkeitsregelungen.
        </p>
        <p>
          EU-Online-Streitbeilegung:{' '}
          <a
            href="https://ec.europa.eu/consumers/odr"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'var(--coral)' }}
          >
            https://ec.europa.eu/consumers/odr
          </a>
        </p>
      </Section>

      <Section title="14. Kontakt">
        <p>
          Bei Fragen zu diesen Nutzungsbedingungen wende dich an:{' '}
          <a href="mailto:legal@getjamie.app" style={{ color: 'var(--coral)' }}>
            legal@getjamie.app
          </a>
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
