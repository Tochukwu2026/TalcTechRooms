const test = require('node:test');
const assert = require('node:assert/strict');
const { computeCostBreakdown } = require('../../src/modules/checkout/checkoutMath');

// Rates as seeded in src/db/seeds/002_admin_settings.sql (the defaults at the time the
// decisions log's worked examples were written).
const settings = {
  commissionPercent: 15,
  vatPercent: 7.5,
  adminFeeNaira: 100,
  smsCostNaira: 5.9,
};

test('Booking worked example: N20,000 rent -> N21,613.84 total, N1,507.94 VAT, N3,000 commission', () => {
  const result = computeCostBreakdown(20000, settings);
  assert.equal(result.adminCostsNaira, 105.9);
  assert.equal(result.vatNaira, 1507.94);
  assert.equal(result.totalChargedNaira, 21613.84);
  assert.equal(result.commissionNaira, 3000);
  assert.equal(result.payoutGrossNaira, 17000);
});

test('Executive subscription worked example: N10,000 base -> N10,863.84 total, N757.94 VAT (corrected figure)', () => {
  const result = computeCostBreakdown(10000, settings);
  assert.equal(result.adminCostsNaira, 105.9);
  assert.equal(result.vatNaira, 757.94);
  assert.equal(result.totalChargedNaira, 10863.84);
  // No commission/payout split for the subscription itself - the caller just ignores these.
});

test('commission + payout always sum back to exactly the base amount (no kobo drift)', () => {
  for (const base of [1, 19999.99, 20000, 12345.67, 999999.5]) {
    const result = computeCostBreakdown(base, settings);
    assert.equal(
      Math.round((result.commissionNaira + result.payoutGrossNaira) * 100),
      Math.round(base * 100)
    );
  }
});

test('handles a zero-commission / zero-VAT setting without dividing by anything odd', () => {
  const result = computeCostBreakdown(20000, { ...settings, commissionPercent: 0, vatPercent: 0 });
  assert.equal(result.commissionNaira, 0);
  assert.equal(result.payoutGrossNaira, 20000);
  assert.equal(result.vatNaira, 0);
  assert.equal(result.totalChargedNaira, 20105.9);
});
