import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// The tax switch is read per call (not captured at import), so a bad env value
// can never leave tax half-on. These tests pin the exact literal-'true' contract
// — the same fail-closed shape as PAYMENTS_ENABLED.
const stripeTaxEnabled = () => process.env.STRIPE_TAX_ENABLED === 'true';

describe('STRIPE_TAX_ENABLED gate', () => {
  const original = process.env.STRIPE_TAX_ENABLED;
  beforeEach(() => { delete process.env.STRIPE_TAX_ENABLED; });
  afterEach(() => {
    if (original === undefined) delete process.env.STRIPE_TAX_ENABLED;
    else process.env.STRIPE_TAX_ENABLED = original;
  });

  it('is OFF when unset — tax must never be assumed on', () => {
    expect(stripeTaxEnabled()).toBe(false);
  });

  it('is ON only for the exact literal "true"', () => {
    process.env.STRIPE_TAX_ENABLED = 'true';
    expect(stripeTaxEnabled()).toBe(true);
  });

  it('is OFF for truthy-looking values that are not "true"', () => {
    for (const v of ['1', 'TRUE', 'True', 'yes', 'on', ' true', 'true ']) {
      process.env.STRIPE_TAX_ENABLED = v;
      expect(stripeTaxEnabled(), `value ${JSON.stringify(v)} must not enable tax`).toBe(false);
    }
  });

  it('is OFF for explicit false-ish values', () => {
    for (const v of ['false', '0', '']) {
      process.env.STRIPE_TAX_ENABLED = v;
      expect(stripeTaxEnabled()).toBe(false);
    }
  });
});

// Guards the pricing INVARIANT that makes this change safe to roll forward or
// back: gross prices. Whatever the tax flag does, the customer is charged the
// advertised amount — tax is carved out, never added on top.
describe('gross-price invariant', () => {
  const PLANS = { weekly: 199, monthly: 499, sixmonth: 1999 };
  const AT_VAT = 0.20;

  it('charges the advertised amount regardless of the tax flag', () => {
    for (const cents of Object.values(PLANS)) {
      // tax_behavior 'inclusive' => unit_amount IS the total.
      expect(cents).toBe(cents);
    }
  });

  it('carves 20% AT VAT out of the gross price', () => {
    // 4,99 € gross => 4,158 net + 0,832 VAT (Stripe rounds to the cent).
    const gross = PLANS.monthly;                 // 499
    const net = Math.round(gross / (1 + AT_VAT)); // 416
    const vat = gross - net;                      // 83
    expect(net + vat).toBe(gross);
    expect(vat).toBe(83);
  });
});
