import React, { memo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

/**
 * Sponsored cooperation card. Two visual variants:
 * - variant="explore" — large landscape card (Bild 1 left): photo fills, the
 *   "Jamie Deal" pill, company name and 2-word headline sit in the bottom-left
 *   over a gradient. Used between regular feed entries on /explore.
 * - variant="home"    — compact card that drops into the 2-col groups grid
 *   on /home (Bild 1 right): same dimensions as a GroupCard so the row
 *   doesn't jump. Title is the 2-word headline, subtitle is the company name.
 */
export const DealCard = memo(({ deal, variant = 'explore' }) => {
  const navigate = useNavigate();
  const { t } = useTranslation();

  if (!deal) return null;

  const photo = Array.isArray(deal.photos) && deal.photos.length > 0 ? deal.photos[0] : null;
  const company = deal.name || '';
  const headline = deal.deal_label || '';

  const onClick = () => navigate(`/deal/${deal.id}`);

  // ── Home/Gruppen variant: matches GroupCard footprint ──────────
  if (variant === 'home') {
    return (
      // role/tabIndex/keydown rather than a real <button> so the .group-card
      // grid styles (shared with GroupCard, a div) aren't disturbed, while the
      // card stays keyboard- and screen-reader-operable.
      <div
        className="group-card deal-card-home"
        onClick={onClick}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      >
        <span className="card-badge deal-card-home-badge">
          {t('deals.card.badge')}
        </span>

        <div className="card-header">
          <div className="card-text-area">
            <h3 className="card-title deal-card-home-title">{headline}</h3>
            <div className="card-subtitle-row">
              <span className="deal-card-home-company">{company}</span>
            </div>
          </div>
        </div>

        <div className="card-photo-grid">
          <div
            className="avatar-slot card-club-full-image"
            style={{ gridColumn: '1 / -1', gridRow: '1 / -1', borderRadius: '9px' }}
          >
            {photo ? (
              <img src={photo} alt={company} loading="lazy" decoding="async" />
            ) : (
              <div className="avatar-placeholder" style={{ fontSize: 48, fontWeight: 700 }}>
                {(company || 'D')[0].toUpperCase()}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Explore variant: large hero, bottom-left overlay ──────────
  return (
    <button className="deal-card-explore" onClick={onClick} type="button">
      {photo ? (
        <img
          src={photo}
          alt={company}
          className="deal-card-explore-img"
          loading="lazy"
          decoding="async"
        />
      ) : (
        <div className="deal-card-explore-placeholder">
          <span>{(company || 'D')[0].toUpperCase()}</span>
        </div>
      )}
      <div className="deal-card-explore-gradient" />
      <div className="deal-card-explore-overlay">
        <span className="deal-card-explore-pill">{t('deals.card.badge')}</span>
        <span className="deal-card-explore-company">{company}</span>
        <span className="deal-card-explore-headline">{headline}</span>
        <span className="deal-card-explore-info" aria-hidden="true">ⓘ</span>
      </div>
    </button>
  );
});

export default DealCard;
