const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM = process.env.EMAIL_FROM || 'JAMIE <onboarding@resend.dev>';
const FRONTEND_URL = () => process.env.FRONTEND_URL || 'http://localhost:5173';

const sendEmail = async ({ to, subject, html }) => {
  if (!RESEND_API_KEY) {
    console.warn('[email] RESEND_API_KEY not set — skipping email to', to);
    return;
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ from: FROM, to, subject, html })
  });

  const data = await res.json();

  if (!res.ok) {
    console.error('[email] Resend error:', data);
    throw new Error(data.message || 'Failed to send email');
  }

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
          Hallo ${userName || ''},<br><br>
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
          Hallo ${userName || ''},<br><br>
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
            Hallo ${userName || ''},<br><br>
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
