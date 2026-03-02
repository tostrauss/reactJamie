import nodemailer from 'nodemailer';

// Create reusable transporter
// In production: use a real SMTP service (SendGrid, Resend, AWS SES, etc.)
// In development: uses Ethereal (free fake SMTP) or console logging
let transporter = null;

const getTransporter = async () => {
  if (transporter) return transporter;

  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (host && user && pass) {
    // Production: real SMTP
    transporter = nodemailer.createTransport({
      host,
      port: parseInt(process.env.SMTP_PORT, 10) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user, pass }
    });
  } else {
    // Development: Ethereal test account
    const testAccount = await nodemailer.createTestAccount();
    transporter = nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      secure: false,
      auth: {
        user: testAccount.user,
        pass: testAccount.pass
      }
    });
    console.log('Email: Using Ethereal test account (dev mode)');
  }

  return transporter;
};

const getFromAddress = () => {
  return process.env.EMAIL_FROM || 'JAMIE <noreply@jamie-app.com>';
};

const getFrontendUrl = () => {
  return process.env.FRONTEND_URL || 'http://localhost:5173';
};

/**
 * Send password reset email
 */
export const sendPasswordResetEmail = async (email, token, userName) => {
  const transport = await getTransporter();
  const resetUrl = `${getFrontendUrl()}/reset-password?token=${token}`;

  const info = await transport.sendMail({
    from: getFromAddress(),
    to: email,
    subject: 'JAMIE - Passwort zurücksetzen',
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 500px; margin: 0 auto; padding: 40px 20px;">
        <h1 style="color: #FD7666; font-size: 28px; margin-bottom: 8px;">JAMIE</h1>
        <h2 style="color: #333; font-size: 20px;">Passwort zurücksetzen</h2>
        <p style="color: #555; line-height: 1.6;">
          Hallo ${userName || ''},<br><br>
          Du hast angefordert, dein Passwort zurückzusetzen.
          Klicke auf den Button unten, um ein neues Passwort zu wählen:
        </p>
        <a href="${resetUrl}" style="display: inline-block; background: #FD7666; color: #fff; padding: 14px 32px; border-radius: 12px; text-decoration: none; font-weight: 600; margin: 24px 0;">
          Neues Passwort setzen
        </a>
        <p style="color: #999; font-size: 14px; line-height: 1.5;">
          Dieser Link ist 1 Stunde gültig.<br>
          Falls du kein Passwort-Reset angefordert hast, ignoriere diese E-Mail.
        </p>
      </div>
    `
  });

  // In dev mode, log the preview URL
  if (!process.env.SMTP_HOST) {
    console.log('Password reset email preview:', nodemailer.getTestMessageUrl(info));
  }

  return info;
};

/**
 * Send email verification
 */
export const sendVerificationEmail = async (email, token, userName) => {
  const transport = await getTransporter();
  const verifyUrl = `${getFrontendUrl()}/verify-email?token=${token}`;

  const info = await transport.sendMail({
    from: getFromAddress(),
    to: email,
    subject: 'JAMIE - E-Mail bestätigen',
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 500px; margin: 0 auto; padding: 40px 20px;">
        <h1 style="color: #FD7666; font-size: 28px; margin-bottom: 8px;">JAMIE</h1>
        <h2 style="color: #333; font-size: 20px;">E-Mail bestätigen</h2>
        <p style="color: #555; line-height: 1.6;">
          Hallo ${userName || ''},<br><br>
          Willkommen bei JAMIE! Bitte bestätige deine E-Mail-Adresse:
        </p>
        <a href="${verifyUrl}" style="display: inline-block; background: #FD7666; color: #fff; padding: 14px 32px; border-radius: 12px; text-decoration: none; font-weight: 600; margin: 24px 0;">
          E-Mail bestätigen
        </a>
        <p style="color: #999; font-size: 14px; line-height: 1.5;">
          Dieser Link ist 24 Stunden gültig.
        </p>
      </div>
    `
  });

  if (!process.env.SMTP_HOST) {
    console.log('Verification email preview:', nodemailer.getTestMessageUrl(info));
  }

  return info;
};
