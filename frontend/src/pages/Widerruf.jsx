import { Link } from 'react-router-dom';

// Widerrufsbelehrung (right-of-withdrawal notice) — Variante A: 14-day Widerruf
// with refund. Static German legal page (mirrors Impressum.jsx). Company data
// from the Impressum (IMPIBAG e.U.). The wording was prepared from the standard
// FAGG template — see WIDERRUF-VORLAGE.md for the source + legal-review note.
export default function Widerruf() {
  return (
    <div className="page" style={{ maxWidth: 700 }}>
      <div style={{ marginBottom: 24 }}>
        <Link to="/settings" style={{ color: 'var(--coral)', textDecoration: 'none', fontSize: 14 }}>
          ← Zurück
        </Link>
      </div>

      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Widerrufsbelehrung</h1>
      <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 32 }}>
        Verbraucher haben das folgende Widerrufsrecht.
      </p>

      <Section title="Widerrufsrecht">
        <p>
          Sie haben das Recht, binnen vierzehn Tagen ohne Angabe von Gründen
          diesen Vertrag zu widerrufen. Die Widerrufsfrist beträgt vierzehn Tage
          ab dem Tag des Vertragsabschlusses (Abschluss des JAMIE Pro-Abonnements).
        </p>
        <p style={{ marginTop: 12 }}>
          Um Ihr Widerrufsrecht auszuüben, müssen Sie uns
        </p>
        <p style={{ marginTop: 12 }}>
          <strong>IMPIBAG e.U.</strong><br />
          Witthauergasse 6/1<br />
          1180 Wien, Österreich<br />
          E-Mail:{' '}
          <a href="mailto:office@jamie-app.com" style={{ color: 'var(--coral)' }}>
            office@jamie-app.com
          </a>
        </p>
        <p style={{ marginTop: 12 }}>
          mittels einer eindeutigen Erklärung (z. B. ein mit der Post versandter
          Brief oder eine E-Mail) über Ihren Entschluss, diesen Vertrag zu
          widerrufen, informieren. Sie können dafür das unten stehende
          Muster-Widerrufsformular verwenden, das jedoch nicht vorgeschrieben ist.
          In der App können Sie den Widerruf außerdem direkt über die Schaltfläche
          „Widerruf erklären“ unter{' '}
          <Link to="/settings" style={{ color: 'var(--coral)' }}>Einstellungen → Abonnement</Link>{' '}
          ausüben.
        </p>
        <p style={{ marginTop: 12 }}>
          Zur Wahrung der Widerrufsfrist reicht es aus, dass Sie die Mitteilung
          über die Ausübung des Widerrufsrechts vor Ablauf der Widerrufsfrist
          absenden.
        </p>
      </Section>

      <Section title="Folgen des Widerrufs">
        <p>
          Wenn Sie diesen Vertrag widerrufen, haben wir Ihnen alle Zahlungen, die
          wir von Ihnen erhalten haben, unverzüglich und spätestens binnen
          vierzehn Tagen ab dem Tag zurückzuzahlen, an dem die Mitteilung über
          Ihren Widerruf dieses Vertrags bei uns eingegangen ist. Für diese
          Rückzahlung verwenden wir dasselbe Zahlungsmittel, das Sie bei der
          ursprünglichen Transaktion eingesetzt haben, es sei denn, mit Ihnen
          wurde ausdrücklich etwas anderes vereinbart; in keinem Fall werden Ihnen
          wegen dieser Rückzahlung Entgelte berechnet.
        </p>
        <p style={{ marginTop: 12 }}>
          Haben Sie verlangt, dass die Dienstleistung während der Widerrufsfrist
          beginnen soll, so haben Sie uns einen angemessenen Betrag zu zahlen, der
          dem Anteil der bis zu dem Zeitpunkt, zu dem Sie uns von der Ausübung des
          Widerrufsrechts unterrichten, bereits erbrachten Dienstleistungen im
          Vergleich zum Gesamtumfang der im Vertrag vorgesehenen Dienstleistungen
          entspricht.
        </p>
      </Section>

      <Section title="Muster-Widerrufsformular">
        <p style={{ marginBottom: 12 }}>
          (Wenn Sie den Vertrag widerrufen wollen, füllen Sie bitte dieses Formular
          aus und senden Sie es zurück.)
        </p>
        <pre style={{
          whiteSpace: 'pre-wrap',
          fontFamily: 'inherit',
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 12,
          padding: 16,
          lineHeight: 1.7,
          fontSize: 14,
        }}>{`An: IMPIBAG e.U., Witthauergasse 6/1, 1180 Wien
office@jamie-app.com

Hiermit widerrufe(n) ich/wir (*) den von mir/uns (*)
abgeschlossenen Vertrag über die Erbringung der folgenden
Dienstleistung: JAMIE Pro-Abonnement

— Bestellt am (*) / erhalten am (*): ____________
— Name des/der Verbraucher(s):       ____________
— Anschrift des/der Verbraucher(s):  ____________
— Datum:                             ____________
— Unterschrift (nur bei Papier)

(*) Unzutreffendes streichen.`}</pre>
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
