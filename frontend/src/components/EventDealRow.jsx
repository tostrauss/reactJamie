import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import VerifiedBadge from './VerifiedBadge';
import { thumbUrl } from '../utils/images';
import '../styles/event-deal-row.css';

// The deal on an event's head card (P4 v1, Tina 16.11.2026, Mock 4): the
// shop's round icon — the deal's photo when it has one —, its name with the ✓
// of a checked partner, the offer in the partner yellow and an arrow. A tap
// goes straight to where it is redeemed: the deal's page /deal/:id with
// „Jetzt einlösen“ (/deal/:id/redeem is only the proof screen after that).
// The server embeds a deal only while it can be redeemed (dealController
// DEAL_VISIBLE_SQL) and decides `verified`; this only draws it. Its own
// component and stylesheet: the club's event list gets it too once Tina's
// design is there — hence no bubbling into a tappable card around it.
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
        {deal.photo ? (
          <img src={thumbUrl(deal.photo)} alt="" loading="lazy" decoding="async" />
        ) : (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 9l1.5-5h15L21 9" />
            <path d="M3 9h18v1.5a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0z" />
            <path d="M5 13v7h14v-7" />
            <path d="M10 20v-4h4v4" />
          </svg>
        )}
      </span>
      <span className="event-deal-row-text">
        <span className="event-deal-row-name">
          <span className="event-deal-row-name-text">{deal.name}</span>
          {deal.verified && (
            <VerifiedBadge className="event-deal-row-check" size={16} title={t('deal.eventRow.verified')} />
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
