// Pro subscription plans — display metadata only. The backend
// (subscriptionController.PRO_PLANS) is authoritative on the actual charged
// amount; here we keep the per-month headline, the struck-through baseline,
// the savings %, and the badge so the ProModal can render the Hinge-style
// pricing grid. Keys MUST match the backend plan keys.
//
// Pricing (repriced 2026-09-17, prev. 2026-08-03):
//   monthly  4,99 €/Monat                            (baseline, struck through on others)
//   sixmonth 19,99 €/6 Monate → 3,33 €/Monat · 33%   DEFAULT + "Beliebt"
//   yearly   34,99 €/Jahr    → 2,92 €/Monat · 42%    "Bestes Angebot"
//
// Why no weekly tier any more (Tina + Tobi, 16.09.2026): weekly terms make the
// invoicing/bookkeeping side a mess (up to 52 Rechnungen pro Abo im Jahr) and
// the week-based headline read as intransparent. The ladder is now monthly and
// the ANCHOR is the monthly price, because that is the number Tina wants in the
// preview on every tile ("Anzeigen kann man ja trotzdem immer die Kosten von
// einem Monat"). The 14-day free trial is untouched.
//
// Per-month headlines are derived so they stay honest:
//   monthly 4,99/1 · 6mo 19,99/6=3,33 · yearly 34,99/12=2,92.
// Savings vs. the 4,99 baseline: 6mo 1-3.33/4.99 = 33% · yearly 1-2.92/4.99 = 42%.

export const BASELINE_MONTHLY = '4,99';

export const PRO_PLANS = [
  {
    key: 'monthly',
    perMonth: '4,99',
    // i18n key suffixes resolved in ProModal via t(`pro.plans.${...}`)
    termKey: 'monthly',
    billedKey: 'billedMonthly',    // "4,99 € / Monat"
    savings: null,
    badgeKey: null,
    strikethrough: false,
  },
  {
    key: 'sixmonth',
    perMonth: '3,33',
    termKey: 'sixmonth',
    billedKey: 'billedSixmonth',   // "19,99 € alle 6 Monate"
    savings: 33,
    badgeKey: 'popular',           // "Beliebt"
    strikethrough: true,
    isDefault: true,
  },
  {
    key: 'yearly',
    perMonth: '2,92',
    termKey: 'yearly',
    billedKey: 'billedYearly',     // "34,99 € pro Jahr"
    savings: 42,
    badgeKey: 'bestValue',         // "Bestes Angebot"
    strikethrough: true,
  },
];

// Pre-selected tile. Deliberately the MIDDLE one, not `monthly`: until today
// monthly WAS the middle tile (weekly sat below it) and carried "Beliebt".
// Dropping weekly turned monthly into the bottom anchor, so keeping the key
// would have preserved the letter of the old default while losing its intent —
// the default would suddenly be the tile with no savings chip.
export const DEFAULT_PLAN_KEY = 'sixmonth';
