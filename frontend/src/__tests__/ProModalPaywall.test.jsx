import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

// Paywall vs Apple 3.1.2 (decision 06.10.2026: 1.4.3 ships with Pro). On the
// iPhone the amount that is actually BILLED must be the clearest price; the
// derived per-month figure may only be secondary, and a free trial must say
// what is charged afterwards next to the button. The web keeps Tina's
// per-month headline. Real German i18n.
const platform = { ios: true };
vi.mock('../utils/platform', () => ({
  isIosIapActive: () => platform.ios,
  isStoreBillingActive: () => platform.ios,
  isPlayBillingActive: () => false,
  purchasesEnabled: () => true,
  paymentsComingSoon: () => false,
}));
vi.mock('../utils/paymentsConfig', () => ({ usePaymentsConfig: () => {} }));
const products = { value: null };
vi.mock('../utils/iap', () => ({
  getIosProducts: vi.fn(async () => products.value),
  subscribePro: vi.fn(),
  restorePurchases: vi.fn(),
}));
vi.mock('../utils/playBilling', () => ({ purchasePlaySubscription: vi.fn(), restorePlayPurchases: vi.fn() }));
vi.mock('../utils/api', () => ({
  subscription: { getStatus: vi.fn(async () => ({ data: { trial_eligible: false } })), create: vi.fn() },
  featureInterest: { get: vi.fn(async () => ({ data: {} })), register: vi.fn() },
}));
vi.mock('../context/ToastContext', () => ({ useToast: () => ({ error: vi.fn(), success: vi.fn(), info: vi.fn() }) }));
vi.mock('@stripe/stripe-js', () => ({ loadStripe: vi.fn() }));
vi.mock('@stripe/react-stripe-js', () => ({
  Elements: ({ children }) => children, PaymentElement: () => null, useStripe: () => null, useElements: () => null,
}));

const { ProModal } = await import('../components/ProModal');

const storeProducts = (trial = null) => ({
  monthly: { productId: 'pro_monthly', price: 6.99, priceString: '6,99 €', pricePerMonth: 6.99, pricePerMonthString: '6,99 €', currencyCode: 'EUR', freeTrial: trial },
  sixmonth: { productId: 'pro_sixmonth', price: 29.99, priceString: '29,99 €', pricePerMonth: 5.0, pricePerMonthString: '5,00 €', currencyCode: 'EUR', freeTrial: trial },
  yearly: { productId: 'pro_yearly', price: 49.99, priceString: '49,99 €', pricePerMonth: 4.17, pricePerMonthString: '4,17 €', currencyCode: 'EUR', freeTrial: trial },
});

const renderModal = async () => {
  render(<ProModal onClose={() => {}} />);
  await act(async () => {});
};

beforeEach(() => { platform.ios = true; products.value = storeProducts(); });

describe('ProModal paywall — App Store (3.1.2)', () => {
  it('the BILLED amount is the headline of each tile; the per-month figure is a secondary "≈" line', async () => {
    await renderModal();
    const billed = screen.getByText('29,99 €');
    expect(billed.style.fontSize).toBe('19px');
    expect(screen.getByText('alle 6 Monate')).toBeTruthy();
    expect(screen.getByText('≈ 5,00 € pro Monat')).toBeTruthy();
    expect(screen.getByText('49,99 €').style.fontSize).toBe('19px');
    expect(screen.getByText('≈ 4,17 € pro Monat')).toBeTruthy();
    // the derived per-month price is never a headline of its own
    expect(screen.queryByText('5,00 €')).toBeNull();
    expect(screen.queryByText('4,17 €')).toBeNull();
  });

  it('no struck-through monthly baseline next to a billed total; monthly shows no "≈" repeat', async () => {
    await renderModal();
    expect(screen.getAllByText('6,99 €')).toHaveLength(1); // only the monthly tile's own billed price
    expect(screen.queryByText('≈ 6,99 € pro Monat')).toBeNull();
  });

  it('with a free trial: the charge afterwards is the loudest line at the button; the button itself does not sell the trial', async () => {
    products.value = storeProducts({ unit: 'DAY', count: 14 });
    await renderModal();
    const then = screen.getByText('Danach 29,99 € alle 6 Monate – jederzeit kündbar.');
    expect(then.style.fontSize).toBe('17px');
    // the trial length is stated once, small, right above it — not at the top
    expect(screen.getAllByText('🎁 Starte mit 14 Tagen kostenlos')).toHaveLength(1);
    const cta = screen.getByRole('button', { name: /Jetzt starten/ });
    expect(then.compareDocumentPosition(cta) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole('button', { name: /kostenlos starten/ })).toBeNull();
  });

  it('a trial counted in months still states its length', async () => {
    products.value = storeProducts({ unit: 'MONTH', count: 1 });
    await renderModal();
    expect(screen.getByText('🎁 Starte mit 1 Monat kostenlos')).toBeTruthy();
  });

  it('no savings pill above the billed amounts on the App Store (the per-tile chip stays)', async () => {
    await renderModal();
    expect(screen.queryByText(/NEU · Spare bis zu/)).toBeNull();
    expect(screen.getByText('40% sparen')).toBeTruthy();
  });

  it('Terms and Privacy are absolute https links — a relative one goes nowhere inside the iOS app', async () => {
    await renderModal();
    expect(screen.getByRole('link', { name: 'AGB' }).getAttribute('href')).toBe('https://app.jamie-app.com/terms');
    expect(screen.getByRole('link', { name: 'Datenschutz' }).getAttribute('href')).toBe('https://app.jamie-app.com/privacy');
  });

  it('no trial line without a trial', async () => {
    await renderModal();
    expect(screen.queryByText(/^Danach /)).toBeNull();
  });
});

describe('ProModal paywall — web keeps the per-month headline', () => {
  it('per-month price big, billed amount secondary, baseline struck through', async () => {
    platform.ios = false;
    await renderModal();
    expect(screen.getByText('5,00 €').style.fontSize).toBe('19px');
    expect(screen.getByText('29,99 € alle 6 Monate')).toBeTruthy();
    expect(screen.queryByText('≈ 5,00 € pro Monat')).toBeNull();
    expect(screen.getByText(/NEU · Spare bis zu 40%/)).toBeTruthy();
  });
});
