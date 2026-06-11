import { Link } from 'react-router-dom';

export default function TermsOfService() {
  return (
    <div className="page" style={{ maxWidth: 760 }}>
      <div style={{ marginBottom: 24 }}>
        <Link to="/settings" style={{ color: 'var(--coral)', textDecoration: 'none', fontSize: 14 }}>
          ← Back
        </Link>
      </div>

      <h1 style={{ fontSize: 26, fontWeight: 700, marginBottom: 8 }}>JAMIE Terms of Service</h1>
      <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 32 }}>
        Version 1.0 · Last updated: 09.06.2026
      </p>

      <Section title="1. Operator">
        <p>JAMIE is operated by:</p>
        <p>
          <strong>IMPIBAG e.U.</strong><br />
          Witthauergasse 6/1<br />
          1180 Vienna<br />
          Austria<br />
          Commercial Register Number: FN 670339v<br />
          VAT Number: ATU82812645<br />
          Commercial Register Court: Commercial Court of Vienna<br />
          Email: <a href="mailto:office@jamie-app.com" style={{ color: 'var(--coral)' }}>office@jamie-app.com</a>
        </p>
        <p>Throughout these Terms, "JAMIE", "we", "us" and "our" refer to IMPIBAG e.U.</p>
      </Section>

      <Section title="2. Acceptance of these Terms">
        <p>By creating an account, accessing or using JAMIE, you agree to be bound by these Terms of Service.</p>
        <p>If you do not agree to these Terms, you must not access or use JAMIE.</p>
        <p>These Terms apply to all users of the JAMIE platform.</p>
      </Section>

      <Section title="3. About JAMIE">
        <p>JAMIE is a social networking and community platform that enables users to:</p>
        <ul>
          <li>create and join activities;</li>
          <li>create and participate in groups;</li>
          <li>create, manage and join clubs;</li>
          <li>communicate through direct messages and group chats;</li>
          <li>share content, images and information;</li>
          <li>discover communities, clubs and activities;</li>
          <li>purchase premium features and digital boosts.</li>
        </ul>
        <p>JAMIE acts solely as a technology platform.</p>
        <p>
          JAMIE is not an organiser, promoter, supervisor or operator of activities,
          meetings, events, clubs or communities created by users.
        </p>
      </Section>

      <Section title="4. Eligibility">
        <p>You must be at least eighteen (18) years old to use JAMIE.</p>
        <p>By using JAMIE, you represent and warrant that:</p>
        <ul>
          <li>you are at least 18 years old;</li>
          <li>all information provided by you is accurate and complete;</li>
          <li>you have the legal capacity to enter into a binding agreement.</li>
        </ul>
        <p>We reserve the right to suspend or terminate accounts where we reasonably believe these requirements are not met.</p>
      </Section>

      <Section title="5. User Accounts">
        <p>Users must register using their real first name and last name.</p>
        <p>
          JAMIE may display only selected parts of a user's name, including a first name,
          initials or other display format determined by JAMIE.
        </p>
        <p>You are responsible for maintaining the confidentiality of your login credentials.</p>
        <p>You agree not to:</p>
        <ul>
          <li>create accounts for other persons;</li>
          <li>transfer your account to another person;</li>
          <li>share access credentials;</li>
          <li>use another person's account;</li>
          <li>create multiple accounts to circumvent restrictions or enforcement actions.</li>
        </ul>
        <p>JAMIE does not guarantee the identity, conduct or intentions of any user.</p>
      </Section>

      <Section title="6. Clubs and Groups">
        <p>JAMIE distinguishes between Clubs and Groups.</p>
        <p>Groups are primarily intended for organising specific activities, discussions or temporary communities.</p>
        <p>
          Clubs are intended for ongoing communities, organisations, associations,
          businesses, sports groups, social communities and similar entities.
        </p>
        <p>Clubs may be operated by:</p>
        <ul>
          <li>private individuals;</li>
          <li>associations;</li>
          <li>community organisations;</li>
          <li>sports clubs;</li>
          <li>businesses;</li>
          <li>other organisations.</li>
        </ul>
        <p>
          JAMIE reserves the right to classify, label, verify, restrict or reclassify Clubs
          according to their actual purpose and use. JAMIE may require additional
          verification for Clubs operated by businesses, organisations or other commercial
          entities and may label such Clubs as Business Clubs, Organisation Clubs or similar
          designations. Any verification, badge, designation or status assigned by JAMIE is
          solely intended to improve the user experience and does not constitute an
          endorsement, certification, guarantee of identity, legitimacy, safety, quality or
          legal compliance of any Club, organisation, business or its activities.
        </p>
        <p>
          Club operators are solely responsible for the content, activities, communications
          and information published through their Club.
        </p>
      </Section>

      <Section title="7. User Content">
        <p>Users may upload, publish, submit or share:</p>
        <ul>
          <li>text;</li>
          <li>photographs;</li>
          <li>profile information;</li>
          <li>comments;</li>
          <li>club information;</li>
          <li>group information;</li>
          <li>messages;</li>
          <li>other content.</li>
        </ul>
        <p>You retain ownership of your content.</p>
        <p>
          By uploading content to JAMIE, you grant us a worldwide, non-exclusive,
          royalty-free licence to host, store, process, reproduce and display such content
          solely for the purpose of operating, maintaining, improving, promoting and
          providing the JAMIE platform and related services.
        </p>
        <p>You represent and warrant that:</p>
        <ul>
          <li>you own or control the necessary rights to your content;</li>
          <li>your content does not violate applicable laws;</li>
          <li>your content does not infringe the rights of third parties.</li>
        </ul>
      </Section>

      <Section title="8. Messaging and Communication">
        <p>JAMIE provides direct messaging and group chat functionality.</p>
        <p>Users are solely responsible for their communications.</p>
        <p>
          JAMIE does not actively monitor all communications and cannot guarantee the
          behaviour of users. JAMIE may use automated tools, algorithms or other
          technological measures to detect spam, fraud, abuse, harmful content or violations
          of these Terms and to improve the safety and integrity of the platform. Users may
          report content, messages, groups, clubs or users that they believe violate these
          Terms, applicable law or the rights of third parties. JAMIE may investigate such
          reports and take appropriate action at its sole discretion.
        </p>
        <p>Users must not use JAMIE for:</p>
        <ul>
          <li>harassment;</li>
          <li>bullying;</li>
          <li>threats;</li>
          <li>spam;</li>
          <li>fraud;</li>
          <li>unlawful conduct;</li>
          <li>hate speech;</li>
          <li>extremist content;</li>
          <li>discriminatory conduct.</li>
        </ul>
      </Section>

      <Section title="9. Activities, Meetings and Communities">
        <p>Activities, meetings and gatherings organised through JAMIE are organised solely by users or Club operators.</p>
        <p>JAMIE does not:</p>
        <ul>
          <li>organise activities;</li>
          <li>supervise activities;</li>
          <li>verify activities;</li>
          <li>guarantee the safety of activities;</li>
          <li>guarantee attendance;</li>
          <li>guarantee the conduct of participants.</li>
        </ul>
        <p>
          Participation in activities is entirely at your own risk. JAMIE is not responsible
          for the acts, omissions, conduct or behaviour of users, whether occurring online or
          offline, including during meetings, activities, social interactions or other
          contacts initiated through the platform. Users are solely responsible for
          exercising appropriate judgment and taking reasonable precautions when interacting
          with other users, attending activities or meeting individuals through JAMIE,
          whether online or offline. JAMIE does not conduct criminal background checks or
          otherwise verify the identity, background or conduct of users unless expressly
          stated otherwise.
        </p>
        <p>
          JAMIE is not responsible for any injury, loss, damage, dispute, misconduct or
          other event arising from participation in any activity, meeting, gathering or
          community interaction.
        </p>
      </Section>

      <Section title="10. Third-Party Services and Third-Party Costs">
        <p>
          JAMIE may contain references, recommendations, locations, advertisements,
          promotions, links or information relating to third-party businesses,
          organisations, clubs, associations, venues or service providers.
        </p>
        <p>Examples include restaurants, cafés, sports facilities, museums, cinemas, event venues, cultural institutions, clubs and associations, and commercial businesses.</p>
        <p>
          Any agreements, purchases, bookings, admissions, memberships, subscriptions,
          tickets, reservations or payments relating to such third-party services are
          concluded exclusively between the user and the respective third party.
        </p>
        <p>
          JAMIE does not act as seller, ticket provider, intermediary, organiser, payment
          processor or contractual partner for such transactions unless expressly stated
          otherwise.
        </p>
        <p>
          JAMIE accepts no responsibility for pricing, availability, quality, refunds,
          cancellations, customer service, safety, legality or performance of third-party
          services.
        </p>
        <p>
          Any promotions, discounts, vouchers, rewards or special offers made available
          through JAMIE are offered solely by the respective third party unless expressly
          stated otherwise. JAMIE is not responsible for the availability, redemption,
          fulfilment or legality of such offers.
        </p>
      </Section>

      <Section title="11. Premium Features, Subscriptions and Boosts">
        <p>JAMIE may offer premium memberships, digital boosts and additional digital features.</p>
        <p>Subscriptions may be offered on a monthly or annual basis.</p>
        <p>
          Subscriptions purchased through Apple App Store or Google Play Store are subject
          to the terms and billing rules of the respective platform provider.
        </p>
        <p>Subscriptions automatically renew unless cancelled before the applicable renewal date through the relevant platform.</p>
        <p>
          Users acknowledge that subscription billing, renewals, cancellations and refunds
          are administered by the respective platform provider and may be subject to the
          policies of Apple App Store or Google Play Store.
        </p>
        <p>Users are solely responsible for managing, modifying or cancelling subscriptions through the platform on which the purchase was made.</p>
        <p>JAMIE may offer digital boosts and similar digital products.</p>
        <p>Digital boosts are non-transferable and may only be used within the JAMIE platform.</p>
        <p>
          To the extent permitted by applicable law, purchases of digital boosts and similar
          digital features are non-refundable once made available to the user.
        </p>
        <p>JAMIE reserves the right to modify, discontinue or replace premium features, subscriptions and boosts at any time.</p>
      </Section>

      <Section title="12. Advertising and Sponsored Content">
        <p>JAMIE may display advertisements, sponsored content, promoted clubs, promoted activities, promoted businesses and commercial recommendations.</p>
        <p>Businesses, clubs and organisations may pay for increased visibility, promotional placement or other advertising opportunities.</p>
        <p>
          The existence of advertising or promotional content does not constitute an
          endorsement, recommendation or guarantee by JAMIE. Verified status, featured
          placement, sponsored placement or promotional visibility does not imply any
          recommendation, guarantee or certification by JAMIE.
        </p>
        <p>Users remain responsible for evaluating any third-party products, services or opportunities.</p>
      </Section>

      <Section title="13. Content Moderation">
        <p>JAMIE reserves the right, but is not obligated, to review, investigate, restrict, remove or disable access to content that may:</p>
        <ul>
          <li>violate these Terms;</li>
          <li>violate applicable laws;</li>
          <li>infringe third-party rights;</li>
          <li>threaten user safety;</li>
          <li>damage the integrity of the platform.</li>
        </ul>
        <p>
          JAMIE may also remove or restrict content, accounts, Clubs or Groups that, in its
          reasonable opinion, are inconsistent with the intended purpose, values, safety
          standards or overall user experience of the platform.
        </p>
        <p>JAMIE may take moderation measures including content removal, warnings, temporary restrictions, temporary suspensions, permanent account termination, and removal of clubs or groups.</p>
      </Section>

      <Section title="14. Prohibited Conduct">
        <p>Users must not:</p>
        <ul>
          <li>engage in unlawful conduct;</li>
          <li>impersonate another person;</li>
          <li>use profile names, profile photographs or other identifying information that falsely suggest an affiliation with another person, organisation, business or public figure;</li>
          <li>upload malicious software;</li>
          <li>engage in fraud or deception;</li>
          <li>distribute spam;</li>
          <li>violate intellectual property rights;</li>
          <li>harass, threaten or abuse others;</li>
          <li>publish pornographic, violent, extremist, terrorist, discriminatory or hateful content;</li>
          <li>publish content encouraging illegal activity.</li>
        </ul>
        <p>JAMIE reserves the right to determine, acting reasonably and in good faith, whether content violates these Terms.</p>
      </Section>

      <Section title="15. Account Deletion">
        <p>Users may delete their account at any time.</p>
        <p>Upon deletion of an account:</p>
        <ul>
          <li>the user profile may be deleted or anonymised;</li>
          <li>public profile information may be removed;</li>
          <li>certain content may be retained where legally required;</li>
          <li>certain content may be retained to preserve the integrity of discussions, groups and clubs.</li>
        </ul>
      </Section>

      <Section title="16. Deleted User Content">
        <p>
          Where a user deletes their account, content that forms part of group discussions,
          club discussions, activity discussions or other community interactions may remain
          visible.
        </p>
        <p>In such cases, personal identifiers may be removed and replaced with labels such as <em>"Deleted User"</em> or <em>"Former User"</em>.</p>
        <p>This is necessary to preserve the continuity, integrity and readability of community interactions.</p>
        <p>
          Direct messages may be deleted, anonymised or otherwise processed in accordance
          with JAMIE's data retention policies and applicable law.
        </p>
      </Section>

      <Section title="17. Club Ownership">
        <p>Club administrators are responsible for managing their Clubs.</p>
        <p>If the sole administrator of a Club deletes their account without transferring ownership, JAMIE may remove the Club and associated content.</p>
        <p>JAMIE is under no obligation to preserve abandoned Clubs.</p>
        <p>
          Groups and associated discussions may remain available after the organiser's
          account has been deleted, particularly where the related activity has already
          occurred and users continue to participate in the discussion.
        </p>
      </Section>

      <Section title="18. Availability of the Service">
        <p>JAMIE aims to provide a reliable and uninterrupted service. However, we do not guarantee that the platform will be available at all times or without interruption.</p>
        <p>Access to JAMIE may be temporarily suspended, restricted or unavailable due to maintenance work, updates, technical issues, security incidents, failures of third-party services or circumstances beyond our reasonable control.</p>
        <p>JAMIE shall not be liable for any loss, damage or inconvenience resulting from temporary interruptions or unavailability of the platform.</p>
      </Section>

      <Section title="19. Intellectual Property">
        <p>
          All rights, title and interest in and to the JAMIE platform, including its
          software, design, branding, logos, trademarks, features and content created by
          JAMIE, remain the exclusive property of IMPIBAG e.U. or its licensors.
        </p>
        <p>Except as expressly permitted under these Terms, users may not copy, modify, distribute, reverse engineer, reproduce, sell, licence or commercially exploit any part of the JAMIE platform.</p>
      </Section>

      <Section title="20. Disclaimer of Warranties">
        <p>To the fullest extent permitted by applicable law, JAMIE is provided on an "as is" and "as available" basis.</p>
        <p>JAMIE makes no representations or warranties regarding the accuracy of user content, the conduct of users, the identity of users, the success of activities, the quality of clubs, the availability of the platform or the compatibility of the platform with specific devices.</p>
        <p>JAMIE does not guarantee that users will find friends, groups or communities, that activities will occur as planned, or that users will achieve any particular outcome through use of the platform.</p>
      </Section>

      <Section title="21. Limitation of Liability">
        <p>Nothing in these Terms excludes or limits liability where such exclusion or limitation is prohibited by applicable law.</p>
        <p>Subject to the foregoing, JAMIE shall not be liable for user behaviour, user-generated content, activities organised by users, clubs operated by users or organisations, disputes between users, loss of opportunities, loss of profits, indirect damages, consequential damages or incidental damages.</p>
        <p>Users acknowledge that activities, meetings, gatherings and social interactions inherently involve risks.</p>
        <p>Participation in any activity arranged through JAMIE is undertaken entirely at the user's own risk.</p>
        <p>
          JAMIE is not responsible for monitoring, supervising, verifying or controlling
          participants, activities, meetings or clubs. Users are solely responsible for
          evaluating whether participation in an activity, club or community is appropriate,
          safe and lawful.
        </p>
      </Section>

      <Section title="22. Indemnification">
        <p>
          Users agree to indemnify and hold harmless IMPIBAG e.U., JAMIE, its owners,
          employees, contractors and partners from any claims, liabilities, damages, losses,
          costs and expenses arising from the user's use of JAMIE, the user's content, the
          user's activities, the user's violation of these Terms, the user's violation of
          applicable law or the user's infringement of third-party rights.
        </p>
      </Section>

      <Section title="23. Data Protection">
        <p>
          JAMIE processes personal data in accordance with its{' '}
          <Link to="/privacy" style={{ color: 'var(--coral)' }}>Privacy Policy</Link>{' '}
          and applicable data protection laws, including the General Data Protection
          Regulation (GDPR).
        </p>
        <p>By using JAMIE, users acknowledge that their personal data may be processed as described in the Privacy Policy.</p>
        <p>The Privacy Policy forms an integral part of these Terms.</p>
      </Section>

      <Section title="24. Changes to the Service">
        <p>JAMIE may modify, update, replace, suspend or discontinue features, functionality or parts of the platform at any time.</p>
        <p>
          JAMIE may offer experimental, beta, preview or early access features. Such features
          may be modified, restricted, suspended or discontinued at any time without prior
          notice. Where legally required, users will be informed of material changes. JAMIE
          may use algorithms, artificial intelligence systems or automated technologies to
          recommend content, Clubs, Groups, activities, businesses or other users, and to
          support moderation, safety and platform operations. JAMIE does not guarantee the
          accuracy or suitability of such recommendations.
        </p>
      </Section>

      <Section title="25. Changes to these Terms">
        <p>JAMIE may amend these Terms from time to time.</p>
        <p>Where required by law, users will be notified of significant changes.</p>
        <p>Continued use of JAMIE after such changes take effect constitutes acceptance of the revised Terms.</p>
        <p>If a user does not agree with the revised Terms, they must discontinue use of JAMIE and may delete their account.</p>
      </Section>

      <Section title="26. Termination">
        <p>JAMIE may suspend or terminate a user's access to the platform at any time where these Terms are violated, applicable laws are violated, user safety is threatened, platform integrity is threatened, or fraudulent or abusive conduct is detected.</p>
        <p>Termination may occur with or without prior notice where reasonably necessary.</p>
      </Section>

      <Section title="27. Governing Law">
        <p>These Terms shall be governed by and construed in accordance with the laws of the Republic of Austria, excluding its conflict of laws provisions.</p>
        <p>Consumers residing within the European Union shall continue to benefit from any mandatory consumer protection provisions applicable in their country of residence.</p>
      </Section>

      <Section title="28. Jurisdiction">
        <p>For users acting in the course of a business, trade or profession, the competent courts of Vienna, Austria shall have exclusive jurisdiction.</p>
        <p>Where mandatory consumer protection laws provide otherwise, consumers may bring claims before the courts having jurisdiction at their place of residence.</p>
      </Section>

      <Section title="29. Severability">
        <p>If any provision of these Terms is found to be invalid, unlawful or unenforceable, the remaining provisions shall remain in full force and effect.</p>
        <p>The invalid provision shall be replaced by a valid provision that most closely reflects the original commercial and legal intent.</p>
      </Section>

      <Section title="30. Entire Agreement">
        <p>
          These Terms, together with the{' '}
          <Link to="/privacy" style={{ color: 'var(--coral)' }}>Privacy Policy</Link>{' '}
          and the{' '}
          <Link to="/guidelines" style={{ color: 'var(--coral)' }}>Community Guidelines</Link>{' '}
          (and any additional legal documents expressly incorporated by reference),
          constitute the entire agreement between the user and JAMIE regarding the use of the
          platform.
        </p>
      </Section>

      <Section title="31. Contact">
        <p>For questions regarding these Terms, please contact:</p>
        <p>
          <strong>IMPIBAG e.U.</strong><br />
          Witthauergasse 6/1<br />
          1180 Vienna<br />
          Austria<br />
          Email: <a href="mailto:office@jamie-app.com" style={{ color: 'var(--coral)' }}>office@jamie-app.com</a>
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
