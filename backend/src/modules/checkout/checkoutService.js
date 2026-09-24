const { pool } = require('../../db/pool');
const ApiError = require('../../utils/ApiError');
const availability = require('../booking/availabilityService');
const { computeCostBreakdown } = require('./checkoutMath');

const SETTINGS_KEYS = [
  'commission_percent',
  'vat_percent',
  'admin_fee_naira',
  'sms_cost_naira',
  'executive_subscription_naira',
];

/**
 * Commission %, VAT %, the flat admin fee and SMS cost are all Admin-editable
 * (admin_settings table, src/db/migrations/0004_*) rather than hardcoded, so a rate change
 * from the Admin dashboard takes effect immediately with no redeploy. Read fresh each call -
 * this is a 5-row table, not worth caching yet.
 */
async function getAdminSettings(client = pool) {
  const { rows } = await client.query(
    `SELECT key, value FROM admin_settings WHERE key = ANY($1)`,
    [SETTINGS_KEYS]
  );
  const map = Object.fromEntries(rows.map((r) => [r.key, Number(r.value)]));
  const missing = SETTINGS_KEYS.filter((k) => map[k] === undefined || Number.isNaN(map[k]));
  if (missing.length > 0) {
    throw new ApiError(500, `Missing or invalid admin settings: ${missing.join(', ')}`);
  }
  return {
    commissionPercent: map.commission_percent,
    vatPercent: map.vat_percent,
    adminFeeNaira: map.admin_fee_naira,
    smsCostNaira: map.sms_cost_naira,
    executiveSubscriptionNaira: map.executive_subscription_naira,
  };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Full checkout preview for a stay: Total Cost of Rent (nightly rate * nights * units), the
 * Admin Costs/VAT/commission breakdown, and how many units are actually still free for these
 * dates (spec/requirements-v1.md > Bookings Homepage "Total Price, nightly price breakdown").
 * Public/read-only - does NOT create a booking or hold the units. Real booking creation needs
 * Paystack, which isn't wired up yet (see decisions log) - this just answers "what would this
 * cost, and can I even book that many units for these dates".
 */
async function getBookingCheckoutPreview(accommodationId, checkIn, checkOut, unitsRequested) {
  const { rows } = await pool.query(
    `SELECT number_of_units, nightly_rent_naira FROM accommodations WHERE id = $1 AND is_active = true`,
    [accommodationId]
  );
  if (rows.length === 0) {
    throw new ApiError(404, 'Accommodation not found.');
  }
  const numberOfUnits = rows[0].number_of_units;
  const nightlyRentNaira = Number(rows[0].nightly_rent_naira);

  if (unitsRequested > numberOfUnits) {
    throw new ApiError(400, `This listing only has ${numberOfUnits} unit(s) in total.`);
  }

  const nights = Math.round(
    (new Date(`${checkOut}T00:00:00Z`).getTime() - new Date(`${checkIn}T00:00:00Z`).getTime()) / 86400000
  );

  const unitsAvailable = await availability.getUnitsAvailable(accommodationId, numberOfUnits, checkIn, checkOut);
  if (unitsRequested > unitsAvailable) {
    throw new ApiError(409, `Only ${unitsAvailable} unit(s) are available for these dates.`);
  }

  const settings = await getAdminSettings();
  const rentNaira = round2(nightlyRentNaira * nights * unitsRequested);
  const breakdown = computeCostBreakdown(rentNaira, settings);

  return {
    accommodationId,
    checkIn,
    checkOut,
    nights,
    unitsRequested,
    unitsAvailable,
    nightlyRentNaira,
    rentNaira: breakdown.baseAmountNaira,
    adminCostsNaira: breakdown.adminCostsNaira,
    vatNaira: breakdown.vatNaira,
    totalChargedNaira: breakdown.totalChargedNaira,
    commissionNaira: breakdown.commissionNaira,
    renterGrossPayoutNaira: breakdown.payoutGrossNaira,
  };
}

/**
 * The Executive Customer monthly subscription's own breakdown (same Admin Costs/VAT
 * treatment, no commission/payout split since there's no Renter side to it). Matches the
 * ₦10,863.84/month worked example in the decisions log at the seeded default rates.
 */
async function getExecutiveSubscriptionPreview() {
  const settings = await getAdminSettings();
  const breakdown = computeCostBreakdown(settings.executiveSubscriptionNaira, settings);
  return {
    baseFeeNaira: breakdown.baseAmountNaira,
    adminCostsNaira: breakdown.adminCostsNaira,
    vatNaira: breakdown.vatNaira,
    totalChargedNaira: breakdown.totalChargedNaira,
  };
}

module.exports = { getAdminSettings, getBookingCheckoutPreview, getExecutiveSubscriptionPreview };
