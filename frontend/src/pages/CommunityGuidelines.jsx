import { Link } from 'react-router-dom';

export default function CommunityGuidelines() {
  return (
    <div className="page" style={{ maxWidth: 760 }}>
      <div style={{ marginBottom: 24 }}>
        <Link to="/settings" style={{ color: 'var(--coral)', textDecoration: 'none', fontSize: 14 }}>
          ← Back
        </Link>
      </div>

      <h1 style={{ fontSize: 26, fontWeight: 700, marginBottom: 8 }}>JAMIE Community Guidelines</h1>
      <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 32 }}>
        Last updated: 09.06.2026
      </p>

      <Section title="Welcome to JAMIE!">
        <p>
          JAMIE is a place to connect with people, build communities, organise activities,
          and create meaningful experiences. To help keep the platform safe, welcoming, and
          enjoyable for everyone, we ask all users to follow these Community Guidelines.
        </p>
      </Section>

      <Section title="1. Be Respectful">
        <p>Treat other users with kindness and respect.</p>
        <p>Do not:</p>
        <ul>
          <li>Harass, bully, intimidate, or threaten others.</li>
          <li>Engage in hate speech or discriminatory behaviour.</li>
          <li>Promote violence or extremism.</li>
          <li>
            Target individuals or groups based on race, ethnicity, nationality, religion,
            gender, sexual orientation, disability, or any other protected characteristic.
          </li>
        </ul>
        <p>Healthy disagreements are welcome, but personal attacks are not.</p>
      </Section>

      <Section title="2. Be Authentic">
        <p>Be yourself.</p>
        <p>You may not:</p>
        <ul>
          <li>Impersonate another person or organisation.</li>
          <li>Create fake or misleading profiles.</li>
          <li>Misrepresent your identity or affiliations.</li>
          <li>Create multiple accounts to avoid restrictions or enforcement actions.</li>
        </ul>
        <p>Use accurate information and help build a trustworthy community.</p>
      </Section>

      <Section title="3. Share Appropriate Content">
        <p>You're responsible for the content you post.</p>
        <p>Do not share:</p>
        <ul>
          <li>Illegal content.</li>
          <li>Pornographic or sexually explicit material.</li>
          <li>Graphic or excessively violent content.</li>
          <li>Terrorist or extremist material.</li>
          <li>Content promoting criminal or dangerous activities.</li>
          <li>Fraudulent or deceptive information.</li>
          <li>Content that infringes someone else's intellectual property rights.</li>
        </ul>
        <p>Only post content that you have the right to share.</p>
      </Section>

      <Section title="4. Keep Conversations Safe">
        <p>Messaging and group chats should help people connect positively.</p>
        <p>Do not:</p>
        <ul>
          <li>Send spam or unsolicited promotions.</li>
          <li>Scam or deceive other users.</li>
          <li>Send abusive or threatening messages.</li>
          <li>Repeatedly contact users who do not wish to engage.</li>
        </ul>
        <p>Respect personal boundaries and privacy.</p>
      </Section>

      <Section title="5. Organise Activities Responsibly">
        <p>JAMIE helps people discover activities and communities, but users organise their own events.</p>
        <p>When creating activities or clubs:</p>
        <ul>
          <li>Provide accurate information.</li>
          <li>Be honest about costs and expectations.</li>
          <li>Treat participants fairly and respectfully.</li>
          <li>Follow all applicable laws and local regulations.</li>
        </ul>
        <p>Always use good judgment when meeting people or attending activities.</p>
      </Section>

      <Section title="6. Build Positive Communities">
        <p>Club and Group administrators should create welcoming environments.</p>
        <p>Administrators should:</p>
        <ul>
          <li>Moderate discussions responsibly.</li>
          <li>Encourage respectful behaviour.</li>
          <li>Remove harmful or inappropriate content where appropriate.</li>
          <li>
            Follow these Guidelines and the{' '}
            <Link to="/terms" style={{ color: 'var(--coral)' }}>Terms of Service</Link>.
          </li>
        </ul>
        <p>Verified or featured status does not exempt anyone from these rules.</p>
      </Section>

      <Section title="7. Respect Businesses and Third Parties">
        <p>Many activities may involve local businesses or organisations.</p>
        <p>Do not:</p>
        <ul>
          <li>Post false or misleading reviews.</li>
          <li>Misrepresent commercial relationships.</li>
          <li>Abuse promotional offers or discounts.</li>
        </ul>
        <p>Treat businesses and community partners with the same respect as other users.</p>
      </Section>

      <Section title="8. Protect Privacy">
        <p>Respect the privacy of others.</p>
        <p>Do not:</p>
        <ul>
          <li>Share personal information without permission.</li>
          <li>Publish private conversations or confidential information.</li>
          <li>Stalk, track, or intimidate other users.</li>
        </ul>
        <p>Always obtain consent before sharing someone else's personal details or photos.</p>
      </Section>

      <Section title="9. Help Keep JAMIE Safe">
        <p>If you see behaviour that violates these Guidelines:</p>
        <ul>
          <li>Report the content or user.</li>
          <li>Avoid engaging in harassment or retaliation.</li>
          <li>Help create a positive and safe community.</li>
        </ul>
        <p>Our moderation systems and team may review reported content and take appropriate action.</p>
      </Section>

      <Section title="10. Enforcement">
        <p>Violations of these Guidelines may result in actions including:</p>
        <ul>
          <li>Content removal;</li>
          <li>Warnings;</li>
          <li>Temporary restrictions;</li>
          <li>Temporary suspension;</li>
          <li>Permanent account removal;</li>
          <li>Removal of Clubs or Groups.</li>
        </ul>
        <p>We may take action where necessary to protect users and maintain the integrity of the JAMIE community.</p>
      </Section>

      <Section title="Our Community Values">
        <p>JAMIE is built around a few simple principles:</p>
        <p>
          <strong>Be respectful.</strong> Treat people the way you'd like to be treated.<br />
          <strong>Be genuine.</strong> Create real connections and honest communities.<br />
          <strong>Be responsible.</strong> Take ownership of your actions, both online and offline.<br />
          <strong>Be inclusive.</strong> Everyone should feel welcome and safe.<br />
          <strong>Have fun.</strong> Meet new people, discover communities, and enjoy the experience.
        </p>
        <p>Together, we can make JAMIE a positive place for everyone.</p>
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
