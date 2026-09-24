// Rent/Admin Costs/VAT/commission arithmetic - see spec/decisions-and-phasing.md > Business
// Rules > Customer Checkout Cost Breakdown. Pure functions, no DB access, so they're cheap to
// unit test directly against the two worked examples in the decisions log.
//
// Everything is computed in integer kobo (1 naira = 100 kobo) and only converted back to naira
// at the end. This is deliberate: the decisions log records that the founder's own manual
// arithmetic for the Executive subscription figure was off by ₦0.25 (₦758.19 vs the correct
// ₦757.94) until it was implemented this way with real integer-kobo arithmetic - floating-point
// naira math (e.g. 100.05 + 5.90 in JS numbers) is exactly the kind of thing that reintroduces
// that class of error, so don't "simplify" this back to plain naira arithmetic.

function toKobo(naira) {
  return Math.round(Number(naira) * 100);
}

function toNaira(kobo) {
  return kobo / 100;
}

/**
 * @param {number} baseAmountNaira - the amount Admin Costs/VAT/commission apply on top of:
 *   a booking's Total Cost of Rent, or the Executive subscription's base fee.
 * @param {{commissionPercent:number, vatPercent:number, adminFeeNaira:number, smsCostNaira:number}} settings
 *   - admin-editable (admin_settings table), never hardcoded - see checkoutService.getAdminSettings.
 */
function computeCostBreakdown(baseAmountNaira, settings) {
  const baseKobo = toKobo(baseAmountNaira);
  const adminCostsKobo = toKobo(settings.adminFeeNaira) + toKobo(settings.smsCostNaira);
  const taxableBaseKobo = baseKobo + adminCostsKobo; // VAT base = Rent (or subscription fee) + Admin Costs, see decisions log
  const vatKobo = Math.round((taxableBaseKobo * settings.vatPercent) / 100);
  const totalChargedKobo = taxableBaseKobo + vatKobo;

  // Commission/payout split applies to the base amount ONLY - VAT and Admin Costs never
  // enter this math (spec/decisions-and-phasing.md > Business Rules > Commission).
  const commissionKobo = Math.round((baseKobo * settings.commissionPercent) / 100);
  const payoutGrossKobo = baseKobo - commissionKobo;

  return {
    baseAmountNaira: toNaira(baseKobo),
    adminCostsNaira: toNaira(adminCostsKobo),
    vatNaira: toNaira(vatKobo),
    totalChargedNaira: toNaira(totalChargedKobo),
    commissionNaira: toNaira(commissionKobo),
    payoutGrossNaira: toNaira(payoutGrossKobo),
  };
}

module.exports = { toKobo, toNaira, computeCostBreakdown };
