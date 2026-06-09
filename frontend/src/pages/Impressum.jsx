import { Link } from 'react-router-dom';

export default function Impressum() {
  return (
    <div className="page" style={{ padding: '24px 20px 80px', maxWidth: 700, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <Link to="/settings" style={{ color: 'var(--coral)', textDecoration: 'none', fontSize: 14 }}>
          ← Zurück
        </Link>
      </div>

      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Impressum</h1>
      <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 32 }}>
        Angaben gemäß § 5 ECG (Österreich) / § 25 MedienG
      </p>

      <Section title="Medieninhaberin und Betreiberin">
        <p>
          <strong>JAMIE</strong> wird betrieben von:<br />
          <strong>IMPIBAG e.U.</strong><br />
          Witthauergasse 6/1<br />
          1180 Wien<br />
          Österreich
        </p>
      </Section>

      <Section title="Unternehmensgegenstand">
        <p>
          Entwicklung, Betrieb und Bereitstellung der JAMIE-Plattform und damit
          verbundener digitaler Community-Dienste.
        </p>
      </Section>

      <Section title="Inhaberin">
        <p>Tina Glavanovitz</p>
      </Section>

      <Section title="Kontakt">
        <p>
          E-Mail:{' '}
          <a href="mailto:office@jamie-app.com" style={{ color: 'var(--coral)' }}>
            office@jamie-app.com
          </a>
        </p>
      </Section>

      <Section title="Firmenbuch">
        <p>
          Firmenbuchnummer: <strong>FN 670339v</strong><br />
          Firmenbuchgericht: Handelsgericht Wien
        </p>
      </Section>

      <Section title="Umsatzsteuer-Identifikationsnummer">
        <p>ATU82812645</p>
      </Section>

      <Section title="Aufsichtsbehörde / Gewerbebehörde">
        <p>Magistrat der Stadt Wien</p>
      </Section>

      <Section title="Kammer">
        <p>Wirtschaftskammer Wien</p>
      </Section>

      <Section title="Anwendbare Rechtsvorschriften">
        <p>
          Gewerbeordnung 1994 (GewO).<br />
          Abrufbar unter:{' '}
          <a
            href="https://www.ris.bka.gv.at"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'var(--coral)' }}
          >
            https://www.ris.bka.gv.at
          </a>
        </p>
      </Section>

      <Section title="Blattlinie / Redaktionelle Leitlinie">
        <p>
          JAMIE ist eine Plattform zur Entdeckung von Communities, zur Organisation
          von Aktivitäten und zur Vernetzung von Menschen mit gemeinsamen Interessen.
        </p>
      </Section>

      <Section title="Datenschutz">
        <p>
          Anfragen zum Datenschutz richte bitte an{' '}
          <a href="mailto:office@jamie-app.com" style={{ color: 'var(--coral)' }}>
            office@jamie-app.com
          </a>
          . Details findest du in unserer{' '}
          <Link to="/privacy" style={{ color: 'var(--coral)' }}>Datenschutzerklärung</Link>.
        </p>
      </Section>

      <Section title="Haftungsausschluss">
        <p>
          Trotz sorgfältiger inhaltlicher Kontrolle übernehmen wir keine Haftung für
          die Inhalte externer Links. Für den Inhalt der verlinkten Seiten sind
          ausschließlich deren Betreiber verantwortlich.
        </p>
      </Section>

      <Section title="Online-Streitbeilegung">
        <p>
          Die Europäische Kommission stellt eine Plattform zur Online-Streitbeilegung
          (OS) bereit:{' '}
          <a
            href="https://ec.europa.eu/consumers/odr"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'var(--coral)' }}
          >
            https://ec.europa.eu/consumers/odr
          </a>
          . Wir sind nicht bereit oder verpflichtet, an Streitbeilegungsverfahren vor
          einer Verbraucherschlichtungsstelle teilzunehmen.
        </p>
      </Section>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 10, color: 'var(--text-primary)' }}>
        {title}
      </h2>
      <div style={{ color: 'var(--text-secondary)', lineHeight: 1.7, fontSize: 15 }}>
        {children}
      </div>
    </div>
  );
}
