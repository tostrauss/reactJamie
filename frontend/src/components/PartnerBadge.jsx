import { useTranslation } from 'react-i18next';
import StarIcon from './StarIcon';

// „☆ Partner" (Tina 16.11.2026): an official club's own event. The server
// decides (group.is_partner, backend utils/clubGate.js partnerSql); this only
// draws it, with one look everywhere — outline and text in the partner
// yellow (global.css tokens), never a yellow fill: Tina rejected the
// khaki-filled Mock 1. Two shapes:
//   'tab'  — bottom-left tab on the Gruppen-feed card, the mirror image of
//            its date badge top right (GroupCard, P1)
//   'pill' — next to the category pill on the event page (GroupDetail, P2)
// Screen readers hear „Event eines JAMIE-Partners", not the bare word.
export default function PartnerBadge({ variant = 'pill' }) {
  const { t } = useTranslation();
  return (
    <span className={`partner-badge partner-badge--${variant}`}>
      <StarIcon
        className="partner-badge-star"
        size={variant === 'tab' ? 10 : 12}
        strokeWidth="2.4"
        strokeLinejoin="round"
      />
      <span className="partner-badge-label" aria-hidden="true">{t('groups.card.partnerBadge')}</span>
      <span className="sr-only">{t('groups.card.partnerAria')}</span>
    </span>
  );
}
