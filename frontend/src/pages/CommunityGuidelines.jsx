import { Link } from 'react-router-dom';

export default function CommunityGuidelines() {
  return (
    <div className="page" style={{ maxWidth: 760 }}>
      <div style={{ marginBottom: 24 }}>
        <Link to="/settings" style={{ color: 'var(--coral)', textDecoration: 'none', fontSize: 14 }}>
          ← Back
        </Link>
      </div>

      <h1 style={{ fontSize: 26, fontWeight: 700, marginBottom: 8 }}>JAMIE.Groups Community Guidelines</h1>
      <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 32 }}>
        Last updated: 03.09.2026
      </p>

      <Section title="Welcome to JAMIE.Groups!">
        <p>
          JAMIE.Groups is a place to connect with people, build communities, organise
          activities and create meaningful experiences in real life. To keep the platform
          safe, welcoming and enjoyable for everyone, we ask all users to follow these
          Community Guidelines.
        </p>
      </Section>

      <Section title="1. Be respectful">
        <p>Treat others with respect – online and in real life.</p>
        <p>
          Do not harass, bully, intimidate or threaten others. Hate speech, discrimination,
          exclusion, violence and extremist content or behaviour have no place on
          JAMIE.Groups.
        </p>
        <p>
          Do not target individuals or groups based on race, ethnicity, nationality,
          religion, gender, sexual orientation, disability or any other protected
          characteristic.
        </p>
        <p>Healthy disagreements are welcome. Personal attacks are not.</p>
      </Section>

      <Section title="2. Find your vibe – but stay open">
        <p>Not every activity or group is for everyone, and that's okay.</p>
        <p>
          You can create private groups and decide who joins your activity to make sure the
          group feels like a good fit. At the same time, JAMIE.Groups is built around
          openness, inclusion and meeting people beyond your existing circle.
        </p>
        <p>
          Use group settings responsibly and never to discriminate against or intentionally
          exclude people based on protected characteristics.
        </p>
      </Section>

      <Section title="3. Keep Groups social, not commercial">
        <p>
          Groups on JAMIE.Groups are designed for people to connect through shared
          activities and should generally be non-commercial in nature.
        </p>
        <p>
          Do not use Groups primarily to advertise businesses, sell products or services,
          recruit customers or repeatedly promote commercial offers.
        </p>
        <p>
          Verified Clubs and partners may promote their own activities or events. Where
          tickets or paid services are offered, payments and transactions may be handled by
          third-party providers. JAMIE.Groups is not the seller or organiser unless
          explicitly stated otherwise.
        </p>
      </Section>

      <Section title="4. Be authentic">
        <p>JAMIE.Groups works best when people know who they are meeting.</p>
        <p>Do not:</p>
        <ul>
          <li>impersonate another person or organisation;</li>
          <li>create fake or intentionally misleading profiles;</li>
          <li>misrepresent your identity or affiliation;</li>
          <li>use another person's photos as your own; or</li>
          <li>
            create additional accounts to avoid restrictions, suspensions or other
            enforcement actions.
          </li>
        </ul>
        <p>
          When participating in Groups or Clubs, your profile must include a recognisable
          photo of yourself where your face is clearly visible.
        </p>
      </Section>

      <Section title="5. Share appropriate content">
        <p>Only share content that is appropriate for the JAMIE.Groups community.</p>
        <p>
          Do not post or share illegal content, pornography or sexually explicit content,
          graphic violence, extremist material, scams, spam or content intended to deceive
          or harm others.
        </p>
        <p>Content involving sexual exploitation or abuse is strictly prohibited.</p>
      </Section>

      <Section title="6. Keep conversations safe">
        <p>Chats should help people connect – not make others uncomfortable or unsafe.</p>
        <p>
          Do not send unwanted sexual messages, threats, repeated unwanted messages, spam or
          abusive content. Respect people's boundaries. If someone does not want to continue
          a conversation or asks you to stop contacting them, respect that.
        </p>
      </Section>

      <Section title="7. Organise activities responsibly">
        <p>
          If you create a Group or activity, provide accurate information about what
          participants can expect.
        </p>
        <p>
          Do not intentionally mislead people about the activity, location, costs,
          participants or purpose of a Group. Activities must comply with applicable laws
          and should not unnecessarily put participants or others at risk.
        </p>
        <p>
          Everyone remains responsible for their own decisions, actions and personal safety
          when meeting others in real life.
        </p>
      </Section>

      <Section title="8. Respect Clubs, businesses and third parties">
        <p>Clubs, venues and other partners are part of the JAMIE.Groups community too.</p>
        <p>
          Respect their rules, staff, venues and offers. Do not misuse Deals, tickets,
          promotions or other benefits.
        </p>
        <p>
          Unless explicitly stated otherwise, third-party businesses and organisers are
          responsible for their own events, products, services, payments and offers.
        </p>
      </Section>

      <Section title="9. Protect privacy">
        <p>Respect your own privacy and the privacy of others.</p>
        <p>
          Do not share someone else's private information, photos, messages or contact
          details without their permission. Never use JAMIE.Groups to collect, publish or
          misuse personal information about another person.
        </p>
        <p>
          Think carefully before sharing sensitive personal information with people you have
          not met.
        </p>
      </Section>

      <Section title="10. Help keep JAMIE.Groups safe">
        <p>
          If you see something that violates these Guidelines or makes you feel unsafe,
          please report it.
        </p>
        <p>
          Depending on the situation, JAMIE.Groups may remove content, restrict features,
          remove Groups or activities, issue warnings, temporarily suspend accounts or
          permanently remove users from the platform.
        </p>
        <p>Serious or repeated violations may result in immediate suspension or removal.</p>
      </Section>

      <Section title="11. Our Community Values">
        <p>
          <strong>Be real. Be respectful. Be open.</strong>
        </p>
        <p>
          JAMIE.Groups exists to make it easier to meet new people and spend less time
          scrolling and more time experiencing real life together.
        </p>
        <p>
          Different personalities, backgrounds and interests are what make a community
          interesting. Treat people the way you'd want to be treated, respect boundaries and
          help us build a community where people feel comfortable showing up.
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
