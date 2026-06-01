import nodemailer from 'nodemailer';

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
const _effectiveFrom = _rawFrom || 'noreply@jamie.app';
const _match = _effectiveFrom.match(/<(.+)>/);
const FROM_EMAIL = _match ? _match[1] : _effectiveFrom;
const FRONTEND_URL = () => process.env.FRONTEND_URL || 'http://localhost:5173';

// Lazy-initialised transporter — only created on first send so missing SMTP
// vars don't crash the server on startup (they just fail at send time).
let _transporter = null;
const getTransporter = () => {
  if (_transporter) return _transporter;
  const port = parseInt(process.env.SMTP_PORT, 10) || 587;
  _transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp-relay.brevo.com',
    port,
    // 465 = implicit TLS, anything else = STARTTLS via requireTLS.
    secure: port === 465,
    // Force STARTTLS upgrade. Without this nodemailer will silently fall
    // back to plaintext if the server doesn't advertise STARTTLS — which
    // means our SMTP_PASS goes over the wire in cleartext.
    requireTLS: port !== 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    tls: {
      // Refuse to connect if the SMTP cert doesn't validate. Default is
      // permissive — flipping this off catches MITM on the SMTP route.
      rejectUnauthorized: true,
      minVersion: 'TLSv1.2',
    },
  });
  return _transporter;
};

const sendEmail = async ({ to, subject, html }) => {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.warn('[email] SMTP_USER / SMTP_PASS not set — skipping email to', to);
    return;
  }

  const transporter = getTransporter();
  const info = await transporter.sendMail({
    from: `${FROM_NAME} <${FROM_EMAIL}>`,
    to,
    subject,
    html,
  });

  console.log('[email] Sent to', to, '— messageId:', info.messageId);
  return info;
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
