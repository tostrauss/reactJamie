import { Sentry } from '../config/sentry.js';

const escapeHtml = (str) => String(str || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#x27;');

const FROM_NAME = 'JAMIE';
const _rawFrom = process.env.EMAIL_FROM;
if (!_rawFrom && process.env.NODE_ENV === 'production') {
  console.error('FATAL: EMAIL_FROM environment variable must be set in production');
  process.exit(1);
}
const _effectiveFrom = _rawFrom || 'noreply@jamie-app.com';
// Accept either "JAMIE <noreply@x>" or bare "noreply@x" — Resend expects the
// header form, so we always rebuild it from the parsed parts below.
const _addrMatch = _effectiveFrom.match(/<(.+)>/);
const FROM_EMAIL = _addrMatch ? _addrMatch[1] : _effectiveFrom;
const FROM_HEADER = `${FROM_NAME} <${FROM_EMAIL}>`;

const FRONTEND_URL = () => process.env.FRONTEND_URL?.split(',')[0]?.trim() || 'http://localhost:5173';

const RESEND_URL = 'https://api.resend.com/emails';

// One attempt against the Resend API with a hard timeout: SMTP would block
// the request handler indefinitely on a dead provider. Resend usually
// responds in <500ms; 4s per attempt is generous.
const sendOnce = async (apiKey, payload) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);
  try {
    return await fetch(RESEND_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
};

const sendEmail = async ({ to, subject, html }) => {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn('[email] RESEND_API_KEY not set — skipping email to', to);
    return;
  }

  const payload = { from: FROM_HEADER, to, subject, html };

  // 429/5xx get ONE retry after a short backoff (2M2M TV-spike readiness,
  // 2026-08-04): Resend rate-limits per second — during a signup burst a
  // brief 429 is expected and retrying ~800ms later usually lands in the
  // next token-bucket window. Without this, the user saw "E-Mail konnte
  // nicht gesendet werden" on the very first provider hiccup.
  let response = await sendOnce(apiKey, payload);
  if (!response.ok && (response.status === 429 || response.status >= 500)) {
    await new Promise(r => setTimeout(r, 800));
    response = await sendOnce(apiKey, payload);
  }

  if (!response.ok) {
    // Read the body for diagnostics but DO NOT include the request payload —
    // it contains the OTP / reset URL. Resend's error body is just a message.
    const errBody = await response.text().catch(() => '');
    const msg = `Resend ${response.status}: ${errBody.slice(0, 300)}`;
    console.error('[email] send failed:', msg);
    Sentry.captureMessage?.(`Email send failed: ${response.status}`, {
      level: 'error',
      extra: { to, subject, status: response.status },
    });
    throw new Error(msg);
  }

  const data = await response.json().catch(() => ({}));
  console.log('[email] Sent to', to, '— id:', data.id);
  return data;
};

export const sendPasswordResetEmail = async (email, token, userName) => {
  const resetUrl = `${FRONTEND_URL()}/reset-password?token=${token}`;
  return sendEmail({
    to: email,
    subject: 'JAMIE - Passwort zurücksetzen',
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:500px;margin:0 auto;padding:40px 20px;">
        <h1 style="color:#FD7666;font-size:28px;margin-bottom:8px;">JAMIE</h1>
        <h2 style="color:#333;font-size:20px;">Passwort zurücksetzen</h2>
        <p style="color:#555;line-height:1.6;">
          Hallo ${escapeHtml(userName)},<br><br>
          Du hast angefordert, dein Passwort zurückzusetzen.
          Klicke auf den Button unten, um ein neues Passwort zu wählen:
        </p>
        <a href="${resetUrl}" style="display:inline-block;background:#FD7666;color:#fff;padding:14px 32px;border-radius:12px;text-decoration:none;font-weight:600;margin:24px 0;">
          Neues Passwort setzen
        </a>
        <p style="color:#999;font-size:14px;line-height:1.5;">
          Dieser Link ist 1 Stunde gültig.<br>
          Falls du kein Passwort-Reset angefordert hast, ignoriere diese E-Mail.
        </p>
      </div>
    `
  });
};

export const sendVerificationEmail = async (email, token, userName) => {
  const verifyUrl = `${FRONTEND_URL()}/verify-email?token=${token}`;
  return sendEmail({
    to: email,
    subject: 'JAMIE - E-Mail bestätigen',
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:500px;margin:0 auto;padding:40px 20px;">
        <h1 style="color:#FD7666;font-size:28px;margin-bottom:8px;">JAMIE</h1>
        <h2 style="color:#333;font-size:20px;">E-Mail bestätigen</h2>
        <p style="color:#555;line-height:1.6;">
          Hallo ${escapeHtml(userName)},<br><br>
          Willkommen bei JAMIE! Bitte bestätige deine E-Mail-Adresse:
        </p>
        <a href="${verifyUrl}" style="display:inline-block;background:#FD7666;color:#fff;padding:14px 32px;border-radius:12px;text-decoration:none;font-weight:600;margin:24px 0;">
          E-Mail bestätigen
        </a>
        <p style="color:#999;font-size:14px;line-height:1.5;">
          Dieser Link ist 24 Stunden gültig.
        </p>
      </div>
    `
  });
};

export const sendAdminReportEmail = async (reporterId, type, targetId, reason) => {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail) return;
  return sendEmail({
    to: adminEmail,
    subject: `[JAMIE] Neue Meldung: ${type} #${targetId}`,
    html: `<p>Neue Meldung eingegangen.</p>
           <ul>
             <li><strong>Typ:</strong> ${escapeHtml(type)}</li>
             <li><strong>ID:</strong> ${targetId}</li>
             <li><strong>Grund:</strong> ${escapeHtml(reason)}</li>
             <li><strong>Gemeldet von User #:</strong> ${reporterId}</li>
           </ul>`,
  });
};

export const sendAdminClubPendingEmail = async (club, ownerUserId) => {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail || !club) return;
  const adminUrl = `${FRONTEND_URL()}/admin#clubs-pending`;
  return sendEmail({
    to: adminEmail,
    subject: `[JAMIE] Neuer Club wartet auf Freischaltung: ${club.name || '#' + club.id}`,
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;padding:32px 20px;">
        <h2 style="color:#FD7666;margin:0 0 8px;">Neuer Club wartet auf Freischaltung</h2>
        <p style="color:#555;line-height:1.55;">
          Ein User hat einen Club erstellt. Bitte prüfen und freigeben oder ablehnen.
        </p>
        <table style="border-collapse:collapse;margin:18px 0;">
          <tr><td style="padding:4px 8px;color:#888;">Name:</td><td style="padding:4px 8px;font-weight:600;">${escapeHtml(club.name || '')}</td></tr>
          <tr><td style="padding:4px 8px;color:#888;">Kategorie:</td><td style="padding:4px 8px;">${escapeHtml(club.category || '–')}</td></tr>
          <tr><td style="padding:4px 8px;color:#888;">Ort:</td><td style="padding:4px 8px;">${escapeHtml(club.location || '–')}</td></tr>
          <tr><td style="padding:4px 8px;color:#888;">Erstellt von User #:</td><td style="padding:4px 8px;">${ownerUserId}</td></tr>
          <tr><td style="padding:4px 8px;color:#888;vertical-align:top;">Beschreibung:</td><td style="padding:4px 8px;color:#555;">${escapeHtml((club.description || '').slice(0, 400))}</td></tr>
        </table>
        <a href="${adminUrl}" style="display:inline-block;background:#FD7666;color:#fff;padding:12px 28px;border-radius:12px;text-decoration:none;font-weight:600;">
          Im Admin-Dashboard öffnen
        </a>
      </div>
    `
  });
};

// Website contact form (jamie-app.com footer) → forwarded to the office
// inbox. Our minimal sender has no Reply-To support, so the sender's address
// is prominent in the body for manual replies. Subject strips newlines to
// keep header injection impossible even though Resend would reject it anyway.
export const sendContactEmail = async ({ firstName, lastName, email, message }) => {
  const to = process.env.CONTACT_EMAIL || 'office@jamie-app.com';
  const safeName = `${firstName} ${lastName}`.replace(/[\r\n]/g, ' ').slice(0, 120);
  return sendEmail({
    to,
    subject: `Kontaktformular: ${safeName}`,
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:500px;margin:0 auto;padding:40px 20px;background:#f9f9f9;">
        <div style="background:#fff;border-radius:16px;padding:40px 32px;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
          <h1 style="color:#FD7666;font-size:28px;margin:0 0 4px;">JAMIE</h1>
          <h2 style="color:#222;font-size:20px;margin:0 0 20px;">Neue Kontaktanfrage über die Website</h2>
          <p style="color:#555;line-height:1.6;margin:0 0 8px;"><strong>Von:</strong> ${escapeHtml(firstName)} ${escapeHtml(lastName)}</p>
          <p style="color:#555;line-height:1.6;margin:0 0 20px;"><strong>E-Mail:</strong> <a href="mailto:${escapeHtml(email)}" style="color:#FD7666;">${escapeHtml(email)}</a></p>
          <div style="background:#f4f4f4;border-radius:12px;padding:20px;color:#333;line-height:1.6;white-space:pre-wrap;">${escapeHtml(message)}</div>
          <p style="color:#999;font-size:13px;line-height:1.5;margin:20px 0 0;">
            Antworte einfach direkt an die E-Mail-Adresse oben.
          </p>
        </div>
      </div>
    `
  });
};

// In-app feedback → forwarded to the feedback inbox. Like the contact form,
// the DB row (app_feedback) is the source of truth; this is a best-effort
// convenience copy so feedback still lands in the inbox the old mailto used.
export const sendFeedbackEmail = async ({ userName, userEmail, category, platform, message }) => {
  const to = process.env.FEEDBACK_EMAIL || process.env.CONTACT_EMAIL || 'office@jamie-app.com';
  const safeName = String(userName || 'Unbekannt').replace(/[\r\n]/g, ' ').slice(0, 120);
  return sendEmail({
    to,
    subject: `App-Feedback (${category}): ${safeName}`,
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:500px;margin:0 auto;padding:40px 20px;background:#f9f9f9;">
        <div style="background:#fff;border-radius:16px;padding:40px 32px;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
          <h1 style="color:#FD7666;font-size:28px;margin:0 0 4px;">JAMIE</h1>
          <h2 style="color:#222;font-size:20px;margin:0 0 20px;">Neues Feedback aus der App</h2>
          <p style="color:#555;line-height:1.6;margin:0 0 8px;"><strong>Von:</strong> ${escapeHtml(safeName)}${userEmail ? ` (<a href="mailto:${escapeHtml(userEmail)}" style="color:#FD7666;">${escapeHtml(userEmail)}</a>)` : ''}</p>
          <p style="color:#555;line-height:1.6;margin:0 0 20px;"><strong>Kategorie:</strong> ${escapeHtml(category)} · <strong>Plattform:</strong> ${escapeHtml(platform || 'unbekannt')}</p>
          <div style="background:#f4f4f4;border-radius:12px;padding:20px;color:#333;line-height:1.6;white-space:pre-wrap;">${escapeHtml(message)}</div>
        </div>
      </div>
    `
  });
};

export const sendOTPEmail = async (email, code, userName) => {
  return sendEmail({
    to: email,
    subject: 'JAMIE - Dein Bestätigungscode',
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:500px;margin:0 auto;padding:40px 20px;background:#f9f9f9;">
        <div style="background:#fff;border-radius:16px;padding:40px 32px;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
          <h1 style="color:#FD7666;font-size:28px;margin:0 0 4px;">JAMIE</h1>
          <h2 style="color:#222;font-size:20px;margin:0 0 20px;">E-Mail bestätigen</h2>
          <p style="color:#555;line-height:1.6;margin-bottom:28px;">
            Hallo ${escapeHtml(userName)},<br><br>
            Gib diesen Code in der App ein, um deine E-Mail-Adresse zu bestätigen:
          </p>
          <div style="background:#f4f4f4;border-radius:12px;padding:24px;text-align:center;letter-spacing:12px;font-size:40px;font-weight:800;color:#222;margin-bottom:28px;">
            ${code}
          </div>
          <p style="color:#999;font-size:13px;line-height:1.5;margin:0;">
            Der Code ist <strong>10 Minuten</strong> gültig.<br>
            Falls du kein Konto erstellt hast, ignoriere diese E-Mail.
          </p>
        </div>
      </div>
    `
  });
};
