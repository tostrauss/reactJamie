// Pro subscription plans — display metadata only. The backend
// (subscriptionController.PRO_PLANS) is authoritative on the actual charged
// amount; here we keep the per-week headline, the struck-through baseline,
// the savings %, and the badge so the ProModal can render Tina's Hinge-style
// pricing grid. Keys MUST match the backend plan keys.
//
// Pricing (Tina, 2026-06-04):
//   weekly   14,99 €/Woche                          (baseline, struck through on others)
//   monthly  ~22,75 €/Monat → 5,25 €/Woche · 65%    DEFAULT + "Beliebt"
//   sixmonth 58,50 €/6 Monate → 2,25 €/Woche · 85%  "Bestes Angebot"

export const BASELINE_WEEKLY = '14,99';

export const PRO_PLANS = [
  {
    key: 'weekly',
    perWeek: '14,99',
    // i18n key suffixes resolved in ProModal via t(`pro.plans.${...}`)
    termKey: 'weekly',
    billedKey: 'billedWeekly',     // "14,99 € / Woche"
    savings: null,
    badgeKey: null,
    strikethrough: false,
  },
  {
    key: 'monthly',
    perWeek: '5,25',
    termKey: 'monthly',
    billedKey: 'billedMonthly',    // "ca. 22,75 € / Monat"
    savings: 65,
    badgeKey: 'popular',           // "Beliebt"
    strikethrough: true,
    isDefault: true,
  },
  {
    key: 'sixmonth',
    perWeek: '2,25',
    termKey: 'sixmonth',
    billedKey: 'billedSixmonth',   // "58,50 € / 6 Monate"
    savings: 85,
    badgeKey: 'bestValue',         // "Bestes Angebot"
    strikethrough: true,
  },
];

export const DEFAULT_PLAN_KEY = 'monthly';
