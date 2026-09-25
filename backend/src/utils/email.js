import { Sentry } from '../config/sentry.js';
import {
  REASON_LABELS as REPORT_REASON_LABELS,
  TYPE_LABELS as REPORT_TYPE_LABELS,
} from './reportContext.js';

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
// responds in <500ms; 3s per attempt is generous (was 4s — the send is
// awaited inside the OTP request, so per-attempt time is user-facing
// signup-funnel latency under a TV-spike wave; audit 2026-09-02, risk #12).
const sendOnce = async (apiKey, payload) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);
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

  // ONE retry on 429 AND 5xx after a short backoff (2M2M TV-spike readiness):
  // Resend rate-limits per second, so a burst 429 usually clears in the next
  // token-bucket window — and the 5xx retry matters for forgotPassword,
  // which deliberately tells the user "check your inbox" EITHER WAY
  // (anti-enumeration), so a transiently dropped reset mail would be silent
  // and unrecoverable (review 2026-09-02). 3s/attempt + 300ms backoff keeps
  // the in-request worst case ~6.3s (was ~8.8s at 4s/800ms).
  let response = await sendOnce(apiKey, payload);
  if (!response.ok && (response.status === 429 || response.status >= 500)) {
    await new Promise(r => setTimeout(r, 300));
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

// Moderation alert.
//
// Until 2026-09-15 this mail said only "Typ: user · ID: 984 · Grund:
// inappropriate · Gemeldet von User #: 1375" — four numbers and a raw enum
// value. An admin could not tell WHO was reported, BY whom, or WHAT they
// actually did, and the reporter's free-text `details` — which the report
// modal explicitly asks for — was dropped from the mail entirely. Every one of
// those had to be looked up by hand in the database before anything could be
// decided, so in practice nothing was.
//
// `ctx` comes from utils/reportContext.js: the same resolver the admin list
// and the admin push use, so all three surfaces describe a report identically.
const reportRow = (label, value) => value == null || value === ''
  ? ''
  : `<tr>
       <td style="padding:6px 12px 6px 0;color:#888;white-space:nowrap;vertical-align:top;">${escapeHtml(label)}</td>
       <td style="padding:6px 0;color:#222;">${value}</td>
     </tr>`;

export const sendAdminReportEmail = async ({ reportId, type, reason, details, ctx, isUpdate = false }) => {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail) return;

  const { reporter, target } = ctx || {};
  const base = FRONTEND_URL();
  const typeLabel = REPORT_TYPE_LABELS[type] || type;
  const reasonLabel = REPORT_REASON_LABELS[reason] || reason;

  // The subject carries the whole triage-relevant summary: an admin looking at
  // a phone lock screen should not have to open the mail to know what it is.
  const targetName = !target || target.missing
    ? `#${target?.id ?? '?'} (gelöscht)`
    : target.kind === 'message'
      ? `Nachricht von ${target.author?.name || 'Unbekannt'}`
      : (target.name || `#${target.id}`);
  const subject = isUpdate
    ? `[JAMIE] Meldung #${reportId} ergänzt: ${typeLabel} ${targetName} — ${reasonLabel}`
    : `[JAMIE] Meldung #${reportId}: ${typeLabel} ${targetName} — ${reasonLabel}`;

  // ── What was reported ────────────────────────────────────────────────────
  let targetBlock = '';
  if (!target || target.missing) {
    targetBlock = reportRow('Gemeldet', `<em style="color:#b26a00;">${escapeHtml(typeLabel)} #${target?.id ?? '?'} existiert nicht mehr (gelöscht)</em>`);
  } else if (target.kind === 'user') {
    targetBlock =
      reportRow('Gemeldeter Nutzer', `<strong>${escapeHtml(target.name)}</strong> (#${target.id})`) +
      reportRow('E-Mail', target.email ? `<a href="mailto:${escapeHtml(target.email)}" style="color:#FD7666;">${escapeHtml(target.email)}</a>` : '') +
      reportRow('Ort', escapeHtml(target.location)) +
      reportRow('Dabei seit', target.joined_at ? escapeHtml(new Date(target.joined_at).toLocaleDateString('de-AT')) : '') +
      reportRow('Bio', target.bio ? `<span style="color:#555;">${escapeHtml(target.bio)}</span>` : '');
  } else if (target.kind === 'group') {
    targetBlock =
      reportRow(target.entity_type === 'club' ? 'Gemeldeter Club' : 'Gemeldete Gruppe',
        `<strong>${escapeHtml(target.name)}</strong> (#${target.id})${target.deleted ? ' <em style="color:#b26a00;">— gelöscht</em>' : ''}`) +
      // The creator IS the person behind a "Fake-Profil" report on a group —
      // show them like a reported user (mail, member since, prior reports),
      // not just a name (Tobi 25.09.2026: "sollte man nicht sehen wer
      // gemeldet wurde?").
      reportRow('Erstellt von', target.owner
        ? `<strong>${escapeHtml(target.owner.name)}</strong> (#${target.owner.id})`
          + (target.owner.email ? ` · <a href="mailto:${escapeHtml(target.owner.email)}" style="color:#FD7666;">${escapeHtml(target.owner.email)}</a>` : '')
          + (target.owner.joined_at ? `<br><span style="color:#888;">dabei seit ${escapeHtml(new Date(target.owner.joined_at).toLocaleDateString('de-AT'))}</span>` : '')
          + (target.owner.report_count > 0 ? `<br><span style="color:#8a5200;">⚠️ ${target.owner.report_count} weitere Meldung${target.owner.report_count === 1 ? '' : 'en'} gegen diese Person / ihre anderen Gruppen</span>` : '')
        : '<em>gelöschter Account</em>') +
      reportRow('Kategorie', escapeHtml(target.category)) +
      reportRow('Ort', escapeHtml(target.location)) +
      reportRow('Beschreibung', target.description ? `<span style="color:#555;">${escapeHtml(target.description)}</span>` : '');
  } else if (target.kind === 'message') {
    targetBlock =
      reportRow('Autor', target.author ? `<strong>${escapeHtml(target.author.name)}</strong> (#${target.author.id})` : '<em>gelöschter Account</em>') +
      reportRow('Im Chat', target.group ? `${escapeHtml(target.group.name)} (#${target.group.id})` : '') +
      reportRow('Gesendet', target.created_at ? escapeHtml(new Date(target.created_at).toLocaleString('de-AT')) : '') +
      (target.deleted ? reportRow('Status', '<em style="color:#b26a00;">Nachricht wurde inzwischen gelöscht</em>') : '') +
      reportRow('Inhalt',
        `<div style="background:#f4f4f4;border-left:3px solid #FD7666;border-radius:8px;padding:12px 14px;white-space:pre-wrap;word-break:break-word;color:#222;">${escapeHtml(target.content)}</div>`);
  }

  // ── Deep links: one click to the thing, one click to the queue ───────────
  const openLabel = target?.kind === 'message' ? 'Chat öffnen' : `${typeLabel} öffnen`;
  const buttons = [
    target?.path
      ? `<a href="${base}${target.path}" style="display:inline-block;background:#FD7666;color:#fff;padding:12px 24px;border-radius:12px;text-decoration:none;font-weight:600;margin:0 8px 8px 0;">${escapeHtml(openLabel)}</a>`
      : '',
    // Group/club reports: one click to the creator's profile as well.
    target?.kind === 'group' && target.owner?.path
      ? `<a href="${base}${target.owner.path}" style="display:inline-block;background:#fff;color:#FD7666;border:2px solid #FD7666;padding:10px 22px;border-radius:12px;text-decoration:none;font-weight:600;margin:0 8px 8px 0;">Profil von ${escapeHtml(target.owner.name || 'Ersteller')} öffnen</a>`
      : '',
    `<a href="${base}/admin#reports" style="display:inline-block;background:#2b2f44;color:#fff;padding:12px 24px;border-radius:12px;text-decoration:none;font-weight:600;margin:0 8px 8px 0;">Meldungen im Admin-Panel</a>`,
  ].join('');

  // Repeat-offender signal: the third report against the same target is a far
  // stronger one than the first, and this is the only place it is visible
  // without running a query by hand.
  const repeatNote = target?.report_count > 1
    ? `<p style="margin:16px 0 0;padding:10px 14px;background:#fff4e5;border-radius:10px;color:#8a5200;font-size:14px;">
         ⚠️ Das ist bereits die <strong>${target.report_count}.</strong> Meldung gegen ${escapeHtml(typeLabel.toLowerCase())} #${target.id}.
       </p>`
    : '';

  return sendEmail({
    to: adminEmail,
    subject,
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto;padding:32px 20px;">
        <h1 style="color:#FD7666;font-size:24px;margin:0 0 4px;">JAMIE</h1>
        <h2 style="color:#222;font-size:19px;margin:0 0 4px;">${isUpdate ? `Meldung #${reportId} ergänzt` : `Neue Meldung #${reportId}`}</h2>
        ${isUpdate ? '<p style="margin:0 0 12px;padding:8px 12px;background:#e8f0f7;border-radius:8px;color:#26506e;font-size:13px;">Der Melder hat seine noch offene Meldung mit neuen Angaben aktualisiert.</p>' : ''}
        <p style="color:#888;font-size:14px;margin:0 0 20px;">${escapeHtml(typeLabel)} · ${escapeHtml(reasonLabel)}</p>

        <table style="border-collapse:collapse;width:100%;font-size:14px;line-height:1.5;">
          ${targetBlock}
          <tr><td colspan="2" style="padding:8px 0;"><hr style="border:none;border-top:1px solid #eee;margin:0;"></td></tr>
          ${reportRow('Gemeldet von', reporter?.name
            ? `${escapeHtml(reporter.name)} (#${reporter.id})${reporter.email ? ` · <a href="mailto:${escapeHtml(reporter.email)}" style="color:#FD7666;">${escapeHtml(reporter.email)}</a>` : ''}`
            : `#${reporter?.id ?? '?'}`)}
          ${reportRow('Grund', `<strong>${escapeHtml(reasonLabel)}</strong>`)}
          ${reportRow('Begründung', details
            ? `<div style="background:#f4f4f4;border-radius:8px;padding:12px 14px;white-space:pre-wrap;word-break:break-word;color:#222;">${escapeHtml(details)}</div>`
            : '<em style="color:#aaa;">keine Angabe</em>')}
          ${reporter?.reports_filed > 5
            ? reportRow('Hinweis', `<span style="color:#8a5200;">Dieser Nutzer hat bereits ${reporter.reports_filed} Meldungen abgesetzt.</span>`)
            : ''}
        </table>

        ${repeatNote}

        <div style="margin-top:24px;">${buttons}</div>
      </div>
    `,
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
