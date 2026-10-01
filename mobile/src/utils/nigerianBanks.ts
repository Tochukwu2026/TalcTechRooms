// Mirrors backend/src/modules/payments/nigerianBanks.js's NIGERIAN_BANK_NAMES exactly - the
// backend's bankDetailsSchema rejects anything not in that list, so this picklist must stay in
// sync with it (adding a bank is a one-line change in both places, no migration needed).
export const NIGERIAN_BANK_NAMES = [
  'Access Bank',
  'Ecobank Nigeria',
  'Fidelity Bank',
  'First Bank of Nigeria',
  'First City Monument Bank',
  'Guaranty Trust Bank',
  'Keystone Bank',
  'Kuda Microfinance Bank',
  'Moniepoint Microfinance Bank',
  'OPay',
  'PalmPay',
  'Polaris Bank',
  'Providus Bank',
  'Stanbic IBTC Bank',
  'Sterling Bank',
  'Union Bank of Nigeria',
  'United Bank for Africa',
  'Unity Bank',
  'Wema Bank',
  'Zenith Bank',
] as const;
