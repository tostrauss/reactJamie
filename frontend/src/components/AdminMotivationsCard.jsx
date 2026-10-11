import { useTranslation } from 'react-i18next';
import { MOTIVATION_KEYS } from '../utils/motivations';

/**
 * Admin → "Was trifft zu? (Onboarding)": how the onboarding step ① answers
 * are distributed (Tina's checklist, 10.10.2026). Rides on GET /admin/stats
 * (`motivations: { answered, counts: { <key>: n } }`), so it needs no request
 * of its own; an older server — or one inside the boot window of the deploy
 * that adds users.motivations — sends no object and the card renders nothing.
 *
 * Multi-select: each bar is the share of the people who ANSWERED that ticked
 * this option, so the shares add up to more than 100 % by design. One bar per
 * MOTIVATION_KEYS key in allowlist order (never re-sorted by count): the rows
 * stay where they were between visits, and an unpicked option shows its 0.
 *
 * Chart rules (dataviz skill): one series → one colour for every bar (brand
 * coral, as the DAU line in AdminGrowthSection), no legend (the title names
 * it), the unfilled track a faint step of the same hue, thin bars with a
 * rounded data end and a square baseline. Every value is printed as text, so
 * the list itself is the table view — the bars only add the at-a-glance read.
 */
const H2 = { color: '#fff', fontSize: 14, fontWeight: 600, marginBottom: 12, opacity: 0.6, textTransform: 'uppercase', letterSpacing: 1 };
const CARD = { background: 'var(--bg-card, #1e2235)', borderRadius: 16, padding: 16 };
const MUTED = 'rgba(255,255,255,0.5)';
const BAR = '#FD7666';
const TRACK = 'rgba(253,118,102,0.14)';

export const AdminMotivationsCard = ({ motivations }) => {
  const { t } = useTranslation();
  if (!motivations || typeof motivations !== 'object') return null;

  // Number(): pg can deliver a COUNT as a string, and i18next only
  // plural-resolves a numeric count.
  const answered = Math.max(0, Number(motivations.answered) || 0);
  const counts = motivations.counts && typeof motivations.counts === 'object' ? motivations.counts : {};

  return (
    <div style={{ marginBottom: 32 }}>
      <h2 style={H2}>{t('admin.motivations.title')}</h2>
      <div style={CARD}>
        <div style={{ fontSize: 13, color: MUTED, marginBottom: 14 }}>
          {t('admin.motivations.answered', { count: answered })}
        </div>
        {/* role="list": Safari/VoiceOver drop the semantics of list-style:none. */}
        <ul role="list" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {MOTIVATION_KEYS.map((key) => {
            const count = Math.max(0, Number(counts[key]) || 0);
            // count <= answered by construction (one statement, one snapshot);
            // the clamp only guarantees a bar never overflows its track.
            const share = answered > 0 ? Math.min(1, count / answered) : 0;
            return (
              <li key={key} data-motivation={key}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
                  <span style={{ fontSize: 13, color: '#fff', lineHeight: 1.35 }}>
                    {t(`onboarding.goals.options.${key}`)}
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#fff', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                    {count}
                    <span style={{ color: MUTED, fontWeight: 600 }}> · {Math.round(share * 100)}%</span>
                  </span>
                </div>
                <div aria-hidden="true" style={{ height: 8, marginTop: 6, background: TRACK, borderRadius: '0 4px 4px 0' }}>
                  <div style={{ width: `${share * 100}%`, height: '100%', background: BAR, borderRadius: '0 4px 4px 0' }} />
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
};

export default AdminMotivationsCard;
