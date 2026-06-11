import { Link } from 'react-router-dom';

export default function PrivacyPolicy() {
  return (
    <div className="page" style={{ maxWidth: 760 }}>
      <div style={{ marginBottom: 24 }}>
        <Link to="/settings" style={{ color: 'var(--coral)', textDecoration: 'none', fontSize: 14 }}>
          ← Back
        </Link>
      </div>

      <h1 style={{ fontSize: 26, fontWeight: 700, marginBottom: 8 }}>JAMIE Privacy Policy</h1>
      <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 32 }}>
        Last updated: 09.06.2026
      </p>

      <Section title="1. Introduction">
        <p>Welcome to JAMIE.</p>
        <p>
          JAMIE is a social discovery platform designed to help adults build meaningful
          real-life connections through shared interests, communities, groups, clubs and
          activities. Protecting your privacy and personal information is important to us.
          We aim to collect only the information necessary to provide our services, improve
          the platform, maintain a safe community and comply with our legal obligations.
        </p>
        <p>
          This Privacy Policy explains how we collect, use, store, disclose and protect your
          personal data when you use the JAMIE mobile application and related services
          (collectively, the "Services").
        </p>
        <p>
          We process personal data in accordance with applicable data protection laws,
          including the General Data Protection Regulation (EU) 2016/679 ("GDPR") and
          applicable Austrian data protection legislation.
        </p>
        <p>By using JAMIE, you acknowledge that you have read this Privacy Policy.</p>
      </Section>

      <Section title="2. Who We Are">
        <p>JAMIE is operated by:</p>
        <p>
          <strong>IMPIBAG e.U.</strong><br />
          Witthauergasse 6/1<br />
          1180 Vienna<br />
          Austria<br />
          Commercial Register Number: FN 670339v<br />
          VAT Number: ATU82812645<br />
          Email: <a href="mailto:office@jamie-app.com" style={{ color: 'var(--coral)' }}>office@jamie-app.com</a>
        </p>
        <p>
          If you have any questions regarding this Privacy Policy or our processing of your
          personal data, you may contact us using the details above.
        </p>
      </Section>

      <Section title="3. Who Can Use JAMIE">
        <p>JAMIE is intended exclusively for individuals who are at least 18 years old.</p>
        <p>
          We do not knowingly collect personal information from persons under the age of 18.
          If we become aware that an account belongs to someone under 18, we may suspend or
          delete the account and remove associated personal data, unless we are legally
          required to retain certain information.
        </p>
        <p>Users who believe that a minor has created an account may contact us at any time.</p>
      </Section>

      <Section title="4. Information We Collect">
        <h3 style={subhead}>4.1 Information You Provide</h3>
        <p>
          When you create and use a JAMIE account, you may provide us with personal
          information including:
        </p>
        <ul>
          <li>first and last name;</li>
          <li>email address;</li>
          <li>date of birth;</li>
          <li>gender information;</li>
          <li>profile photograph;</li>
          <li>biography;</li>
          <li>interests and hobbies;</li>
          <li>location information such as your city;</li>
          <li>additional profile pictures;</li>
          <li>favourite song (if you choose to set one);</li>
          <li>Spotify profile information if you choose to connect your account;</li>
          <li>content you upload or share;</li>
          <li>messages and communications with other users;</li>
          <li>information relating to groups, clubs and activities you create or join.</li>
        </ul>
        <p>
          Certain information is required to create and maintain an account, while other
          information is optional and may be managed through your account settings.
        </p>

        <h3 style={subhead}>4.2 Information Created Automatically</h3>
        <p>In addition to the information you provide, we automatically process:</p>
        <ul>
          <li>technical identifiers such as your IP address and user-agent string (used for security, abuse prevention and error diagnostics);</li>
          <li>a Google account identifier if you sign in with Google ("Sign in with Google");</li>
          <li>a last-seen timestamp recorded when you actively use the app;</li>
          <li>aggregated usage analytics events (screen views and session duration), retained for a maximum of 90 days, used solely to improve the platform.</li>
        </ul>

        <h3 style={subhead}>4.3 Account Verification</h3>
        <p>
          We use your email address to verify your account and to help prevent fraudulent or
          duplicate registrations. We may also use your contact information for account
          recovery and security purposes.
        </p>

        <h3 style={subhead}>4.4 Groups, Clubs and Activities</h3>
        <p>JAMIE allows users to create and participate in groups, clubs and activities.</p>
        <p>Depending on the settings of the respective feature, information such as:</p>
        <ul>
          <li>group memberships;</li>
          <li>activity participation;</li>
          <li>event attendance;</li>
          <li>hosted activities;</li>
          <li>club memberships;</li>
          <li>invitations;</li>
        </ul>
        <p>may be visible to other users.</p>
        <p>
          Private groups may remain discoverable within the platform, while access to their
          content and participation may be restricted according to the selected privacy
          settings.
        </p>

        <h3 style={subhead}>4.5 Communications</h3>
        <p>When you communicate with other users through JAMIE, we process:</p>
        <ul>
          <li>private messages;</li>
          <li>group chats;</li>
          <li>shared photographs;</li>
          <li>shared videos;</li>
          <li>media attachments.</li>
        </ul>
        <p>These communications are processed to provide the messaging functionality of the platform.</p>

        <h3 style={subhead}>4.6 Location Information</h3>
        <p>JAMIE includes location-based features.</p>
        <p>Users may voluntarily provide location information, including:</p>
        <ul>
          <li>profile location;</li>
          <li>activity locations;</li>
          <li>map locations for events and activities.</li>
        </ul>
        <p>
          <strong>JAMIE does not continuously track users or create movement profiles.</strong>{' '}
          Location information is processed only to provide the relevant platform features
          and according to the choices made by users.
        </p>
      </Section>

      <Section title="5. How We Use Your Information">
        <p>
          We process your personal data only where we have a valid legal basis under
          applicable data protection laws, including the GDPR.
        </p>

        <h3 style={subhead}>Providing the JAMIE Platform</h3>
        <ul>
          <li>create and manage your account;</li>
          <li>verify your identity and email address;</li>
          <li>provide profile functionality;</li>
          <li>enable users to create and join groups, clubs and activities;</li>
          <li>facilitate communication between users;</li>
          <li>provide location-based features;</li>
          <li>allow users to discover communities and events;</li>
          <li>provide premium features and subscriptions;</li>
          <li>maintain account settings and preferences.</li>
        </ul>
        <p>Legal basis: performance of our contract with you under Article 6(1)(b) GDPR.</p>

        <h3 style={subhead}>Improving Our Services</h3>
        <ul>
          <li>improve platform functionality;</li>
          <li>analyse feature usage;</li>
          <li>identify technical issues;</li>
          <li>optimise user experience;</li>
          <li>develop new features.</li>
        </ul>
        <p>
          Where required by law, we will obtain your consent before processing personal data
          for analytics purposes. Legal basis: your consent under Article 6(1)(a) GDPR or
          our legitimate interests under Article 6(1)(f) GDPR, depending on the specific
          processing activity.
        </p>

        <h3 style={subhead}>Safety and Community Protection</h3>
        <ul>
          <li>detect fraud and abuse;</li>
          <li>investigate reports;</li>
          <li>enforce our Terms of Service and Community Guidelines;</li>
          <li>prevent spam and fake accounts;</li>
          <li>protect users and the integrity of the platform;</li>
          <li>respond to legal requests.</li>
        </ul>
        <p>
          Legal basis: our legitimate interest under Article 6(1)(f) GDPR and, where
          applicable, compliance with legal obligations under Article 6(1)(c) GDPR.
        </p>

        <h3 style={subhead}>Communications</h3>
        <p>We process contact information to:</p>
        <ul>
          <li>verify accounts;</li>
          <li>send important service notifications;</li>
          <li>provide password recovery;</li>
          <li>inform users about changes affecting their accounts;</li>
          <li>deliver push notifications where enabled.</li>
        </ul>
        <p>Marketing communications are only sent where permitted by law or where users have provided the necessary consent.</p>

        <h3 style={subhead}>Premium Features</h3>
        <p>If users subscribe to premium features, we process the information necessary to:</p>
        <ul>
          <li>manage subscriptions;</li>
          <li>provide premium functionality;</li>
          <li>process payments;</li>
          <li>prevent payment fraud;</li>
          <li>maintain transaction records.</li>
        </ul>
        <p>Payment information is processed by authorised payment providers.</p>

        <h3 style={subhead}>Legal Compliance</h3>
        <ul>
          <li>comply with legal obligations;</li>
          <li>respond to lawful requests from authorities;</li>
          <li>establish, exercise or defend legal claims;</li>
          <li>comply with tax and accounting obligations.</li>
        </ul>
      </Section>

      <Section title="6. Profile Information, Groups and Activities">
        <p>
          JAMIE is designed to help people connect through shared interests and real-world
          experiences. Certain profile information may therefore be visible to other users.
        </p>
        <p>Depending on your settings and platform features, this may include:</p>
        <ul>
          <li>your first name;</li>
          <li>profile photographs;</li>
          <li>biography;</li>
          <li>interests;</li>
          <li>general location;</li>
          <li>groups and clubs you create;</li>
          <li>activities you organise;</li>
          <li>activities you join;</li>
          <li>mutual connections.</li>
        </ul>
        <p>Users control many aspects of their profile through their account settings.</p>
        <p>
          JAMIE allows users to create public and private groups and clubs. Private groups
          may remain discoverable within the platform, while participation and access to
          content may be restricted according to the selected privacy settings.
        </p>
        <p>Users may create and participate in activities and events. Information relating to activities may include:</p>
        <ul>
          <li>organiser information;</li>
          <li>event details;</li>
          <li>participant lists;</li>
          <li>event locations;</li>
          <li>uploaded media.</li>
        </ul>
        <p>
          Users should carefully consider the information they choose to share with others.
          JAMIE cannot prevent other users from copying or sharing information that has been
          made visible to them.
        </p>
      </Section>

      <Section title="7. Messaging and Shared Content">
        <p>JAMIE provides messaging and communication features between users. These features may include:</p>
        <ul>
          <li>private messages;</li>
          <li>group chats;</li>
          <li>shared photographs;</li>
          <li>shared videos;</li>
          <li>media attachments.</li>
        </ul>
        <p>We process this information to provide the messaging functionality of the platform.</p>
        <p>
          Communications are protected using industry-standard security measures during
          transmission (TLS) and at rest. <strong>JAMIE does not provide end-to-end
          encryption</strong> for messaging services. This means that, subject to applicable
          law and our internal access controls, JAMIE and its service providers may
          technically be able to access message content.
        </p>
        <p>
          Before storage, message text and other user-generated text content (such as group
          and club names) are submitted to an automated content-moderation service operated
          by <strong>OpenAI, Inc. (USA)</strong> to detect harassment, hate speech, threats,
          sexual or otherwise harmful content. Uploaded images are submitted to an automated
          image-moderation service operated by <strong>Sightengine SAS (France)</strong>.
          See Section 12 for further details on these processors.
        </p>
        <p>
          Users are responsible for the information they choose to share through
          communications and should avoid sharing sensitive personal information unless they
          are comfortable doing so.
        </p>
        <p>
          Where necessary to protect users, investigate abuse, comply with legal obligations
          or enforce our Terms of Service and Community Guidelines, we may process
          information relating to communications in accordance with applicable law.
        </p>
        <p>
          If you delete your account, messages previously sent to other users may remain
          visible in their conversations unless deletion is technically possible or legally
          required.
        </p>
        <p>
          Users may block or report other users. Information relating to reports, blocks and
          moderation actions may be processed to maintain the safety and integrity of the
          JAMIE community.
        </p>
      </Section>

      <Section title="8. Location Features">
        <p>JAMIE offers location-based features to help users discover people, communities, groups and activities nearby.</p>
        <p>Users may voluntarily provide location information, including:</p>
        <ul>
          <li>their general profile location;</li>
          <li>locations associated with activities and events;</li>
          <li>map locations selected when creating activities;</li>
          <li>other location information chosen to be shared within the platform.</li>
        </ul>
        <p>
          Providing location information is generally optional but may be necessary to use
          certain features of the Services.
        </p>
        <p>
          <strong>JAMIE does not continuously track users or create movement histories or
          location profiles.</strong> Location information is processed solely to provide the
          requested functionality and improve the user experience within the platform.
        </p>
        <p>
          Users can manage location permissions through their device settings and may modify
          or remove location information from their profile where applicable.
        </p>
        <p>
          The legal basis for processing location information is the performance of our
          contract with users under Article 6(1)(b) GDPR and, where required, the user's
          consent under Article 6(1)(a) GDPR.
        </p>
      </Section>

      <Section title="9. Premium Features and Subscriptions">
        <p>
          JAMIE may offer optional premium features and subscription services. Premium
          services may include additional platform functionality, increased visibility of
          groups, clubs or activities and other enhanced user features.
        </p>
        <p>Where users purchase premium services, we process information necessary to:</p>
        <ul>
          <li>manage subscriptions;</li>
          <li>provide premium functionality;</li>
          <li>maintain transaction records;</li>
          <li>prevent fraudulent transactions;</li>
          <li>provide customer support.</li>
        </ul>
        <p>
          Payment transactions are processed through authorised payment service providers.
          JAMIE does not store complete payment card details.
        </p>
        <p>
          Information relating to subscriptions may be retained for accounting, tax and legal
          compliance purposes where required by applicable law.
        </p>
        <p>
          Legal basis: performance of our contract under Article 6(1)(b) GDPR and compliance
          with legal obligations under Article 6(1)(c) GDPR.
        </p>
      </Section>

      <Section title="10. Promotional Content and Partner Services">
        <p>
          JAMIE may display promotional content, sponsored cooperations, partner activities
          and other commercial information within the platform.
        </p>
        <p>
          Where required by applicable law, we will obtain user consent before processing
          personal data for personalised advertising or similar marketing activities.
        </p>
        <p>
          Third-party partners offering products or services through the platform are
          independently responsible for their own products and services. JAMIE is not
          responsible for transactions or agreements entered into directly between users and
          third-party providers outside the platform.
        </p>
        <p>
          Where users access external services through links or integrations, the privacy
          policies and terms of those third parties may apply.
        </p>
      </Section>

      <Section title="11. Communications and Push Notifications">
        <p>JAMIE may send communications necessary for the operation of the platform. These communications may include:</p>
        <ul>
          <li>account verification;</li>
          <li>password recovery;</li>
          <li>security alerts;</li>
          <li>service announcements;</li>
          <li>updates relating to groups and activities;</li>
          <li>new messages and chat notifications;</li>
          <li>invitations;</li>
          <li>premium subscription information.</li>
        </ul>
        <p>Users may also choose to receive optional notifications and updates.</p>
        <p>
          Push notifications are delivered through standard web-push (VAPID) for browsers
          and Progressive Web App installations, and through the Apple Push Notification
          service (APNs) for the native iOS application. To enable push notifications,
          a notification endpoint or device token may be processed.
        </p>
        <p>
          Users can disable push notifications at any time through the in-app settings or
          their device settings. Transactional and security-related communications may still
          be sent where necessary for the operation and security of the Services.
        </p>
        <p>Marketing communications are provided only where permitted by law and may be withdrawn at any time.</p>
      </Section>

      <Section title="12. Third-Party Service Providers">
        <p>
          JAMIE works with carefully selected third-party service providers to operate,
          secure and improve the Services. Depending on the functionality used, personal
          data may be processed by the following providers:
        </p>

        <h3 style={subhead}>Hosting and Database</h3>
        <p>
          <strong>Railway Corp. (USA)</strong> — provides cloud hosting and the managed
          PostgreSQL database used to operate the JAMIE backend. Personal data stored on the
          platform (account information, content, messages, etc.) is processed on Railway's
          infrastructure.
        </p>

        <h3 style={subhead}>Object Storage and CDN</h3>
        <p>
          <strong>Cloudflare, Inc. (USA)</strong> — Cloudflare R2 stores uploaded images
          (profile pictures, group, club and cooperation photos). Cloudflare's content
          delivery network also accelerates content delivery and protects the platform
          against malicious traffic and attacks.
        </p>

        <h3 style={subhead}>Domain Registration and DNS</h3>
        <p>
          <strong>IONOS SE (Germany, EU)</strong> — registers the domain used to operate
          the Services and provides authoritative DNS resolution. When a user's device
          resolves the JAMIE domain, the request and the originating IP address are
          processed by IONOS's DNS infrastructure.
        </p>

        <h3 style={subhead}>Email Delivery</h3>
        <p>
          <strong>Resend, Inc. (USA)</strong> — delivers transactional emails such as
          account verification, login codes, password recovery and security alerts.
          Recipient email address and email content are transmitted to Resend for delivery.
        </p>

        <h3 style={subhead}>Payment Processing</h3>
        <p>
          <strong>Stripe, Inc. (USA)</strong> — processes subscription payments and digital
          boost purchases. JAMIE does not receive or store complete payment card
          information; payment data is handled directly by Stripe.
        </p>

        <h3 style={subhead}>Error Tracking</h3>
        <p>
          <strong>Sentry, Inc. (USA)</strong> — receives anonymised error reports, stack
          traces, browser and device metadata, and IP addresses when the application
          encounters a technical issue. Passwords, authentication tokens, cookies and chat
          content are stripped server-side before transmission. Session replays mask text
          input and block chat and avatar content. Retention: 30 days.
        </p>

        <h3 style={subhead}>Image Moderation</h3>
        <p>
          <strong>Sightengine SAS (France, EU)</strong> — every uploaded image is submitted
          to Sightengine to be automatically checked for nudity, sexual content and graphic
          violence before it is stored. Images that exceed the configured thresholds are
          rejected.
        </p>

        <h3 style={subhead}>Text Moderation</h3>
        <p>
          <strong>OpenAI, Inc. (USA)</strong> — user-generated text (chat messages, direct
          messages, group and club names and descriptions) is submitted to the OpenAI
          Moderation API for automated screening for hate speech, harassment, threats and
          sexual content. According to OpenAI, content submitted to the Moderation API is
          not used to train models.
        </p>

        <h3 style={subhead}>Maps and Geocoding</h3>
        <p>
          <strong>Google Ireland Ltd.</strong> — Google Maps is used to display interactive
          maps inside the application and to resolve address autocomplete suggestions.
          Map-tile and geocoding requests, together with the user's IP address, are
          transmitted to Google.
        </p>
        <p>
          <strong>OpenStreetMap Foundation (United Kingdom) — Nominatim</strong> — used to
          convert addresses entered when creating groups, clubs and activities into
          geographical coordinates (geocoding). The submitted address and the request
          metadata are transmitted to Nominatim.
        </p>

        <h3 style={subhead}>Authentication, App Distribution and Push Notifications</h3>
        <p>
          <strong>Apple Inc. (USA)</strong> — provides "Sign in with Apple" (optional), iOS
          App Store distribution and the Apple Push Notification service used to deliver
          push notifications to the native iOS application.
        </p>
        <p>
          <strong>Google LLC (USA)</strong> — provides "Sign in with Google" (optional),
          Google Play Store distribution and verification of OAuth identifiers.
        </p>

        <h3 style={subhead}>Music Integration (optional)</h3>
        <p>
          <strong>Spotify AB (Sweden, EU)</strong> — only if you choose to connect Spotify:
          OAuth tokens are stored securely and used to retrieve your selected song,
          top-tracks or recently-played tracks. You can disconnect Spotify at any time in
          the app settings.
        </p>

        <h3 style={subhead}>International Data Transfers</h3>
        <p>
          Where personal data is transferred outside the European Economic Area, the
          transfer is based on either an adequacy decision of the European Commission, the
          EU-US Data Privacy Framework (where the recipient is certified) or the European
          Commission's Standard Contractual Clauses, together with additional safeguards
          where appropriate.
        </p>
        <p>
          These providers process personal data in accordance with their own privacy
          policies and applicable data protection laws. Where service providers process
          personal data on our behalf, appropriate contractual safeguards (in particular
          data processing agreements pursuant to Article 28 GDPR) are implemented.
        </p>
      </Section>

      <Section title="13. International Data Transfers">
        <p>JAMIE primarily processes personal data within the European Economic Area (EEA).</p>
        <p>
          However, some of our service providers may process personal data in countries
          outside the EEA where this is necessary to provide their services.
        </p>
        <p>
          Where personal data is transferred internationally, JAMIE takes reasonable steps to
          ensure that appropriate safeguards are in place in accordance with applicable data
          protection laws. Such safeguards may include:
        </p>
        <ul>
          <li>adequacy decisions adopted by the European Commission;</li>
          <li>Standard Contractual Clauses approved by the European Commission;</li>
          <li>participation in recognised international data transfer frameworks where applicable;</li>
          <li>additional contractual, organisational or technical safeguards where appropriate.</li>
        </ul>
        <p>
          We regularly review our international data transfer arrangements to ensure
          compliance with applicable legal requirements.
        </p>
      </Section>

      <Section title="14. Data Retention and Account Deletion">
        <p>
          We retain personal data only for as long as necessary to provide the Services,
          fulfil the purposes described in this Privacy Policy, comply with legal
          obligations, resolve disputes and enforce our agreements.
        </p>
        <p>As a general principle:</p>
        <ul>
          <li>account information is retained while an account remains active;</li>
          <li>communications and shared content may remain visible to other users where necessary to preserve the integrity of conversations or community interactions;</li>
          <li>groups, clubs and activities created by users may continue to exist after account deletion where their continued existence is necessary for other users or the operation of the platform;</li>
          <li>transaction and accounting records are retained for legally required retention periods;</li>
          <li>aggregated analytics events are retained for a maximum of 90 days and then deleted automatically;</li>
          <li>certain technical and security logs may be retained for a limited period to maintain platform security and investigate abuse.</li>
        </ul>
        <p>Users may delete their accounts through the platform settings.</p>
        <p>
          Deleting an account generally results in the removal or anonymisation of personal
          information associated with that account, unless retention is required by law,
          necessary for legitimate business purposes or necessary to protect the rights,
          safety and security of JAMIE or other users. Certain information may therefore
          remain where legally required or technically necessary.
        </p>
      </Section>

      <Section title="15. Safety, Moderation and Community Protection">
        <p>Maintaining a safe and respectful community is an important part of the JAMIE platform.</p>
        <p>We may process personal data to:</p>
        <ul>
          <li>investigate reports;</li>
          <li>review suspected violations of our Terms of Service or Community Guidelines;</li>
          <li>detect spam, fraud and abusive behaviour;</li>
          <li>prevent misuse of the platform;</li>
          <li>protect users from harmful conduct;</li>
          <li>enforce platform rules;</li>
          <li>comply with legal obligations.</li>
        </ul>
        <p>Users may block and report other users.</p>
        <p>
          Information relating to reports and moderation activities may be retained for an
          appropriate period where necessary to investigate incidents, resolve disputes or
          protect the platform and its users.
        </p>
        <p>
          Legal basis: our legitimate interest in maintaining a safe platform under Article
          6(1)(f) GDPR and, where applicable, compliance with legal obligations under
          Article 6(1)(c) GDPR.
        </p>
      </Section>

      <Section title="16. Security">
        <p>
          JAMIE implements appropriate technical and organisational measures designed to
          protect personal data against accidental or unlawful destruction, loss, alteration,
          unauthorised disclosure or unauthorised access.
        </p>
        <p>These measures may include:</p>
        <ul>
          <li>encryption during transmission (TLS/HTTPS);</li>
          <li>encryption of stored data where appropriate;</li>
          <li>bcrypt hashing of passwords;</li>
          <li>JWT-based authentication and short-lived session tokens;</li>
          <li>rate-limiting and abuse protection;</li>
          <li>access controls and the principle of least privilege;</li>
          <li>monitoring and security logging;</li>
          <li>regular software updates;</li>
          <li>protection against malicious attacks.</li>
        </ul>
        <p>
          While we strive to protect personal data, no method of electronic transmission or
          storage can be guaranteed to be completely secure. Users are encouraged to protect
          their account credentials and to notify us immediately if they believe their
          account has been compromised.
        </p>
      </Section>

      <Section title="17. Your Rights Under GDPR">
        <p>Subject to applicable law, users may have the following rights regarding their personal data:</p>
        <ul>
          <li>the right to access personal data;</li>
          <li>the right to rectify inaccurate information;</li>
          <li>the right to erase personal data;</li>
          <li>the right to restrict processing;</li>
          <li>the right to object to processing;</li>
          <li>the right to data portability;</li>
          <li>the right to withdraw consent at any time where processing is based on consent;</li>
          <li>the right not to be subject to certain automated decision-making processes;</li>
          <li>the right to lodge a complaint with a competent supervisory authority.</li>
        </ul>
        <p>
          Where users wish to exercise their rights, they may contact JAMIE at{' '}
          <a href="mailto:office@jamie-app.com" style={{ color: 'var(--coral)' }}>
            office@jamie-app.com
          </a>
          . We may request reasonable information to verify the identity of the person
          making the request before responding.
        </p>
        <p>
          Users also have the right to object to the processing of personal data carried out
          on the basis of legitimate interests where their particular circumstances justify
          such an objection. Where personal data is processed for direct marketing purposes,
          users have the right to object to such processing at any time.
        </p>
      </Section>

      <Section title="18. Changes to this Privacy Policy">
        <p>
          We may update this Privacy Policy from time to time to reflect changes in our
          Services, technology, legal requirements or business operations.
        </p>
        <p>
          Where appropriate, users will be informed of significant changes through the
          platform or by other suitable means. The latest version of this Privacy Policy
          will always be made available through JAMIE and will indicate the date of the
          most recent update.
        </p>
        <p>
          Continued use of the Services following the effective date of an updated Privacy
          Policy constitutes acknowledgement of the updated version, except where applicable
          law requires additional consent.
        </p>
      </Section>

      <Section title="19. Contact Us">
        <p>
          If you have questions about this Privacy Policy or our processing of personal
          data, you may contact us at:
        </p>
        <p>
          <strong>IMPIBAG e.U.</strong><br />
          Witthauergasse 6/1<br />
          1180 Vienna<br />
          Austria<br />
          Email: <a href="mailto:office@jamie-app.com" style={{ color: 'var(--coral)' }}>office@jamie-app.com</a>
        </p>
        <p>
          Users also have the right to lodge a complaint with the competent data protection
          supervisory authority. For users located in Austria, the competent authority is
          the Austrian Data Protection Authority (Datenschutzbehörde).
        </p>
        <p>
          We encourage users to contact us first so that we can try to resolve any concerns
          directly and efficiently.
        </p>
      </Section>
    </div>
  );
}

const subhead = {
  fontSize: 14, fontWeight: 700, color: 'var(--text-primary)',
  marginTop: 16, marginBottom: 8,
};

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
