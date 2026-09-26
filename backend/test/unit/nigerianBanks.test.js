const test = require('node:test');
const assert = require('node:assert/strict');
const { NIGERIAN_BANK_NAMES, resolveBankCode } = require('../../src/modules/payments/nigerianBanks');

// A stand-in for what Paystack's real GET /bank would return - shaped like their documented
// response (an array of { name, code, ... }), so resolveBankCode can be tested without ever
// calling the real API (see the "NOT YET VERIFIED" caveat in nigerianBanks.js).
const FAKE_PAYSTACK_BANK_LIST = [
  { name: 'Zenith Bank', code: '057' },
  { name: 'Guaranty Trust Bank', code: '058' },
  { name: 'Access Bank Nigeria', code: '044' }, // deliberately has an extra word vs our picklist
];

test('resolveBankCode matches an exact (case-insensitive) name', () => {
  assert.equal(resolveBankCode('zenith bank', FAKE_PAYSTACK_BANK_LIST), '057');
  assert.equal(resolveBankCode('Guaranty Trust Bank', FAKE_PAYSTACK_BANK_LIST), '058');
});

test('resolveBankCode matches when Paystack\'s name has extra words ours doesn\'t', () => {
  // Our picklist says "Access Bank"; Paystack's real list might say "Access Bank Nigeria" - a
  // partial/substring match should still find it.
  assert.equal(resolveBankCode('Access Bank', FAKE_PAYSTACK_BANK_LIST), '044');
});

test('resolveBankCode returns null for a bank name with no match', () => {
  assert.equal(resolveBankCode('Some Bank Paystack Has Never Heard Of', FAKE_PAYSTACK_BANK_LIST), null);
});

test('resolveBankCode returns null for missing/malformed input rather than throwing', () => {
  assert.equal(resolveBankCode('', FAKE_PAYSTACK_BANK_LIST), null);
  assert.equal(resolveBankCode('Zenith Bank', null), null);
  assert.equal(resolveBankCode(null, FAKE_PAYSTACK_BANK_LIST), null);
});

test('every name in NIGERIAN_BANK_NAMES is a non-empty string, with no duplicates', () => {
  assert.ok(NIGERIAN_BANK_NAMES.length > 0);
  for (const name of NIGERIAN_BANK_NAMES) {
    assert.equal(typeof name, 'string');
    assert.ok(name.trim().length > 0);
  }
  assert.equal(new Set(NIGERIAN_BANK_NAMES).size, NIGERIAN_BANK_NAMES.length);
});
