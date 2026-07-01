import { Link } from 'react-router-dom';

export default function ChildSafety() {
  return (
    <div className="page" style={{ maxWidth: 760 }}>
      <div style={{ marginBottom: 24 }}>
        <Link to="/settings" style={{ color: 'var(--coral)', textDecoration: 'none', fontSize: 14 }}>
          ← Back
        </Link>
      </div>

      <h1 style={{ fontSize: 26, fontWeight: 700, marginBottom: 8 }}>JAMIE Child Safety Standards</h1>
      <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 32 }}>
        Last updated: 01.07.2026
      </p>

      <Section title="Our Commitment">
        <p>
          JAMIE has a <strong>zero-tolerance policy</strong> toward child sexual abuse and
          exploitation (CSAE), including child sexual abuse material (CSAM). We prohibit any
          content, conduct, or contact that sexually exploits, endangers, or harms minors on
          our platform, and we act quickly to remove it and report it to the relevant
          authorities.
        </p>
      </Section>

      <Section title="1. JAMIE Is an Adults-Only Platform (18+)">
        <p>
          JAMIE is intended exclusively for adults aged 18 and older. It is not designed for,
          directed to, or intended to be used by children.
        </p>
        <ul>
          <li>Accounts may only be created by people aged 18 or over.</li>
          <li>Accounts identified as belonging to a minor are removed.</li>
          <li>We do not knowingly collect data from children.</li>
        </ul>
      </Section>

      <Section title="2. Prohibited Conduct">
        <p>The following are strictly prohibited and result in immediate removal and reporting:</p>
        <ul>
          <li>Child sexual abuse material (CSAM) in any form.</li>
          <li>Sexualisation of minors, including in text, images, or other media.</li>
          <li>Grooming, solicitation, or attempts to contact or exploit a minor.</li>
          <li>Trafficking, endangerment, or any other abuse or exploitation of minors.</li>
          <li>Links, references, or facilitation of any of the above.</li>
        </ul>
      </Section>

      <Section title="3. How to Report">
        <p>
          If you encounter any content, profile, or message that may involve the abuse or
          exploitation of a minor, report it immediately:
        </p>
        <ul>
          <li>
            <strong>In the app:</strong> use the <em>Report</em> and <em>Block</em> options
            available on every user profile, group, club, and message.
          </li>
          <li>
            <strong>By email:</strong> contact our child safety team at{' '}
            <a href="mailto:office@jamie-app.com" style={{ color: 'var(--coral)' }}>
              office@jamie-app.com
            </a>{' '}
            with the subject line <em>"Child Safety"</em>.
          </li>
        </ul>
        <p>Reports concerning child safety are prioritised and reviewed promptly.</p>
      </Section>

      <Section title="4. Our Response">
        <p>When we become aware of CSAE, we:</p>
        <ul>
          <li>Remove the content and suspend or permanently ban the responsible account(s).</li>
          <li>Preserve relevant evidence as permitted or required by law.</li>
          <li>
            Report to the appropriate authorities, including the National Center for Missing
            &amp; Exploited Children (NCMEC) and/or the competent law enforcement or child
            protection agencies (e.g. in Austria and the EU).
          </li>
        </ul>
      </Section>

      <Section title="5. Point of Contact">
        <p>
          For any child safety concern, or for questions from authorities regarding CSAE, our
          designated point of contact is:
        </p>
        <p>
          <a href="mailto:office@jamie-app.com" style={{ color: 'var(--coral)' }}>
            office@jamie-app.com
          </a>{' '}
          (subject line: <em>"Child Safety"</em>)
        </p>
      </Section>

      <Section title="6. Legal Compliance">
        <p>
          JAMIE complies with applicable child safety laws and regulations in the regions where
          it operates, and cooperates with law enforcement and child protection organisations.
          These standards apply alongside our{' '}
          <Link to="/guidelines" style={{ color: 'var(--coral)' }}>Community Guidelines</Link>{' '}
          and{' '}
          <Link to="/terms" style={{ color: 'var(--coral)' }}>Terms of Service</Link>.
        </p>
      </Section>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section style={{ marginBottom: 28 }}>
      <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 10, color: 'var(--text-primary)' }}>
        {title}
      </h2>
      <div style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
        {children}
      </div>
    </section>
  );
}
