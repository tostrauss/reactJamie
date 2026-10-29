// Screenshot harness mock: StoreKit products exactly as App Store Connect
// serves them in the AT storefront (priceString is what Apple 3.1.2 wants big).
const products = {
  monthly:  { productId: 'pro_monthly',  price: 6.99,  priceString: '6,99 €',  pricePerMonth: 6.99, pricePerMonthString: '6,99 €', currencyCode: 'EUR', freeTrial: null },
  sixmonth: { productId: 'pro_sixmonth', price: 29.99, priceString: '29,99 €', pricePerMonth: 5.0,  pricePerMonthString: '5,00 €', currencyCode: 'EUR', freeTrial: null },
  yearly:   { productId: 'pro_yearly',   price: 49.99, priceString: '49,99 €', pricePerMonth: 4.17, pricePerMonthString: '4,17 €', currencyCode: 'EUR', freeTrial: null },
};
export const getIosProducts = async () => products;
export const subscribePro = async () => {};
export const restorePurchases = async () => ({ restored: 0 });
export const loadPaymentsConfig = async () => {};
export const identifyIapUser = async () => {};
