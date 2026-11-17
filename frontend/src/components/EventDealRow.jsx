import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import '../styles/event-deal-row.css';

// The deal on an event's head card (P4 v1, Tina 16.11.2026, Mock 4 — drawn
// to her picture since 17.11.2026, audit GD-18…25): a framed row in the
// partner yellow, the round shop icon — ALWAYS the shop glyph, the deal's
// photo belongs to the deal's own page —, the name with the ✓ of a checked
// partner as an outlined rosette, the offer in the partner yellow and an
// arrow. A tap goes straight to where it is redeemed: the deal's page
// /deal/:id with „Jetzt einlösen“ (/deal/:id/redeem is only the proof screen
// after that).
// The server embeds a deal only while it can be redeemed (dealController
// DEAL_VISIBLE_SQL) and decides `verified` — JAMIE's own deals and those of
// paying partners; this only draws it. JAMIE's and a club's deal look the
// same, only the ✓ differs. Its own component and stylesheet: the club's
// event list uses it too — hence no bubbling into a tappable card around it.
// Long names and offers end in „…“: one too-wide child let the whole event
// page pan sideways (S3).
export default function EventDealRow({ deal }) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  if (!deal?.id) return null;

  const open = (e) => {
    e.stopPropagation();
    navigate(`/deal/${deal.id}`);
  };

  return (
    <button type="button" className="event-deal-row" onClick={open}>
      <span className="event-deal-row-icon" aria-hidden="true">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 9l1.5-5h15L21 9" />
          <path d="M3 9h18v1.5a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0z" />
          <path d="M5 13v7h14v-7" />
          <path d="M10 20v-4h4v4" />
        </svg>
      </span>
      <span className="event-deal-row-text">
        <span className="event-deal-row-name">
          <span className="event-deal-row-name-text">{deal.name}</span>
          {deal.verified && (
            // Lucide „badge-check“ (ISC licence): the rosette as an outline,
            // like the mock — not the filled purple VerifiedBadge.
            <svg
              className="event-deal-row-check"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              role="img"
              aria-label={t('deal.eventRow.verified')}
            >
              <title>{t('deal.eventRow.verified')}</title>
              <path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z" />
              <path d="m9 12 2 2 4-4" />
            </svg>
          )}
        </span>
        <span className="event-deal-row-label">{deal.deal_label}</span>
      </span>
      <svg className="event-deal-row-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M9 18l6-6-6-6" />
      </svg>
    </button>
  );
}
