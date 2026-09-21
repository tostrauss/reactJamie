// Pro subscription plans — display metadata only. The backend
// (subscriptionController.PRO_PLANS) is authoritative on the actual charged
// amount; here we keep the per-month headline, the struck-through baseline,
// the savings %, and the badge so the ProModal can render the Hinge-style
// pricing grid. Keys MUST match the backend plan keys.
//
// Pricing (repriced 2026-09-21, prev. 2026-09-17 / 2026-08-03):
//   monthly  6,99 €/Monat                            (baseline, struck through on others)
//   sixmonth 29,99 €/6 Monate → 5,00 €/Monat · 28%   DEFAULT + "Beliebt"
//   yearly   49,99 €/Jahr    → 4,17 €/Monat · 40%    "Bestes Angebot"
//
// Why 6,99 and not 4,99 (Tina + Tobi + Arno, Meeting 21.09.2026): the gross
// price has to carry 20 % USt AND the 30 % store commission on iOS — at 4,99 €
// only ~2,91 € net were left per month. 6,99 / 29,99 / 49,99 are the amounts
// the market apparently accepts and all three are valid Apple price points.
//
// Why no weekly tier any more (Tina + Tobi, 16.09.2026): weekly terms make the
// invoicing/bookkeeping side a mess (up to 52 Rechnungen pro Abo im Jahr) and
// the week-based headline read as intransparent. The ladder is now monthly and
// the ANCHOR is the monthly price, because that is the number Tina wants in the
// preview on every tile ("Anzeigen kann man ja trotzdem immer die Kosten von
// einem Monat"). The 14-day free trial is untouched.
//
// Per-month headlines are derived so they stay honest:
//   monthly 6,99/1 · 6mo 29,99/6=5,00 · yearly 49,99/12=4,17.
// Savings vs. the 6,99 baseline: 6mo 1-5.00/6.99 = 28% · yearly 1-4.17/6.99 = 40%.

export const BASELINE_MONTHLY = '6,99';

export const PRO_PLANS = [
  {
    key: 'monthly',
    perMonth: '6,99',
    // i18n key suffixes resolved in ProModal via t(`pro.plans.${...}`)
    termKey: 'monthly',
    billedKey: 'billedMonthly',    // "6,99 € / Monat"
    savings: null,
    badgeKey: null,
    strikethrough: false,
  },
  {
    key: 'sixmonth',
    perMonth: '5,00',
    termKey: 'sixmonth',
    billedKey: 'billedSixmonth',   // "29,99 € alle 6 Monate"
    savings: 28,
    badgeKey: 'popular',           // "Beliebt"
    strikethrough: true,
    isDefault: true,
  },
  {
    key: 'yearly',
    perMonth: '4,17',
    termKey: 'yearly',
    billedKey: 'billedYearly',     // "49,99 € pro Jahr"
    savings: 40,
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
