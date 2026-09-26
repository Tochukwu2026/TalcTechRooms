// Fixes the bank_name-vs-bank_code caveat flagged at the top of paystackProvider.js's
// initiateTransfer: Paystack's real /transferrecipient endpoint needs a numeric `bank_code` (from
// Paystack's own GET /bank list), not a bank's plain name - but a Renter naturally knows their
// bank by name, not by an internal Paystack code they'd have no reason to know.
//
// Two things live here:
//   1. NIGERIAN_BANK_NAMES - a fixed picklist of bank names a Renter can select from when
//      submitting bank details (see validation.js's bankDetailsSchema), instead of free text.
//      Deliberately just names, not codes - a bank's plain name (e.g. "Zenith Bank") is public
//      knowledge and effectively never wrong, unlike Paystack's specific internal numeric code
//      for it, which this file does NOT try to hardcode (bank codes can change, and getting one
//      wrong would silently misroute a real payout - far worse than a free-text mismatch). This
//      list only needs to be "a real bank Paystack supports", which is stable; adding a bank
//      later is a one-line change here, no migration needed (bank_name stays a plain TEXT column).
//   2. resolveBankCode(bankName, paystackBankList) - a pure matching function: given a Renter's
//      stored bank name and the REAL list Paystack returns from GET /bank (fetched live, in
//      paystackProvider.js, at transfer time - see the caveat there about why this isn't cached
//      forever), finds the matching entry and returns its real code. Returns null on no match
//      (a Renter's bank name that doesn't line up with anything in Paystack's current list),
//      which the caller treats as a transfer failure (same "never silently mishandle money"
//      pattern as everywhere else in the payout module) rather than guessing.
//
// NOT YET VERIFIED, same caveat as the rest of paystackProvider.js: this has never been run
// against Paystack's real GET /bank response. Before switching PAYSTACK_MODE to 'paystack',
// confirm the exact shape of a real /bank response (this assumes each entry has `name` and
// `code` fields, per Paystack's published docs) and that these bank names actually match
// Paystack's own naming closely enough for resolveBankCode's matching to succeed for each one.

const NIGERIAN_BANK_NAMES = [
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
];

/**
 * Matches a Renter's chosen bank name against Paystack's real GET /bank list. Case-insensitive
 * and tolerant of Paystack appending something like " Nigeria" or " Plc" that our own picklist
 * name doesn't include (matches if one name contains the other, once both are lowercased and
 * trimmed) - exact string equality would be too brittle against Paystack's own naming quirks.
 * @param {string} bankName - one of NIGERIAN_BANK_NAMES, as stored on the renters row.
 * @param {Array<{name:string, code:string}>} paystackBankList - the real response from GET /bank.
 * @returns {string|null} the matching bank's code, or null if nothing lines up.
 */
function resolveBankCode(bankName, paystackBankList) {
  if (!bankName || !Array.isArray(paystackBankList)) return null;
  const needle = bankName.trim().toLowerCase();

  const exact = paystackBankList.find((b) => (b.name || '').trim().toLowerCase() === needle);
  if (exact) return exact.code;

  const partial = paystackBankList.find((b) => {
    const hay = (b.name || '').trim().toLowerCase();
    return hay.includes(needle) || needle.includes(hay);
  });
  return partial ? partial.code : null;
}

module.exports = { NIGERIAN_BANK_NAMES, resolveBankCode };
