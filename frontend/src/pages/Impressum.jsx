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
        Angaben gemäß § 5 ECG (Österreich) / § 5 TMG (Deutschland)
      </p>

      <Section title="Betreiber">
        <p>
          <strong>JAMIE App</strong><br />
          [Firmenname / Vor- und Nachname]<br />
          [Straße und Hausnummer]<br />
          [PLZ] [Stadt]<br />
          Österreich
        </p>
      </Section>

      <Section title="Kontakt">
        <p>
          E-Mail:{' '}
          <a href="mailto:legal@jamie-app.com" style={{ color: 'var(--coral)' }}>
            legal@jamie-app.com
          </a>
        </p>
      </Section>

      <Section title="Unternehmensgegenstand">
        <p>
          Betrieb einer Social-Activity-Plattform zur Vermittlung von Freizeitaktivitäten,
          Gruppen und Clubs.
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
          Die Europäische Kommission stellt eine Plattform zur Online-Streitbeilegung (OS)
          bereit:{' '}
          <a
            href="https://ec.europa.eu/consumers/odr"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'var(--coral)' }}
          >
            https://ec.europa.eu/consumers/odr
          </a>
          . Wir sind nicht bereit oder verpflichtet, an Streitbeilegungsverfahren vor einer
          Verbraucherschlichtungsstelle teilzunehmen.
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
