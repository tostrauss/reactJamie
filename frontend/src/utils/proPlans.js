// Pro subscription plans — display metadata only. The backend
// (subscriptionController.PRO_PLANS) is authoritative on the actual charged
// amount; here we keep the per-week headline, the struck-through baseline,
// the savings %, and the badge so the ProModal can render the Hinge-style
// pricing grid. Keys MUST match the backend plan keys.
//
// Pricing (repriced 2026-06-11):
//   weekly   4,99 €/Woche                           (baseline, struck through on others)
//   monthly  14,99 €/Monat → 3,46 €/Woche · 31%     DEFAULT + "Beliebt"
//   sixmonth 29,99 €/6 Monate → 1,15 €/Woche · 77%  "Bestes Angebot"

export const BASELINE_WEEKLY = '4,99';

export const PRO_PLANS = [
  {
    key: 'weekly',
    perWeek: '4,99',
    // i18n key suffixes resolved in ProModal via t(`pro.plans.${...}`)
    termKey: 'weekly',
    billedKey: 'billedWeekly',     // "4,99 € / Woche"
    savings: null,
    badgeKey: null,
    strikethrough: false,
  },
  {
    key: 'monthly',
    perWeek: '3,46',
    termKey: 'monthly',
    billedKey: 'billedMonthly',    // "14,99 € / Monat"
    savings: 31,
    badgeKey: 'popular',           // "Beliebt"
    strikethrough: true,
    isDefault: true,
  },
  {
    key: 'sixmonth',
    perWeek: '1,15',
    termKey: 'sixmonth',
    billedKey: 'billedSixmonth',   // "29,99 € alle 6 Monate"
    savings: 77,
    badgeKey: 'bestValue',         // "Bestes Angebot"
    strikethrough: true,
  },
];

export const DEFAULT_PLAN_KEY = 'monthly';
