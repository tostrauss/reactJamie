import PartnerBadge from './PartnerBadge';

// The eyebrow row above the title on the event page (GroupDetail): the grey
// category pill and, for a partner event, „☆ Partner" next to it — also when
// the event has no category (Tina 16.11.2026, P2; the category stays grey).
// One flex row that never widens the head card: the category ends in „…"
// instead (S3 — one too-wide child let the whole page pan sideways). Its own
// component so the rule is testable without rendering the 1,200-line page.
export default function GroupDetailPills({ category, isPartner }) {
  if (!category && !isPartner) return null;
  return (
    <div className="gd-pill-row">
      {category && <span className="gd-category-eyebrow">{category}</span>}
      {isPartner && <PartnerBadge variant="pill" />}
    </div>
  );
}
