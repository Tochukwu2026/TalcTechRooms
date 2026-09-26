// Provider-agnostic notifications interface (SMS + email) - see spec/decisions-and-phasing.md >
// SMS Provider and Notifications (Phase 1). Callers use the two spec-required composed functions
// below (notifyBookingConfirmation / notifyViewingConfirmation) and never touch
// mockProvider/termiiProvider directly, so switching TERMII_MODE in .env is the only thing
// needed to go from mock to real sends - no call-site changes.
//
// A notification failure NEVER blocks or rolls back the action it's confirming (a booking or a
// viewing is already real and paid-for/reserved by the time these are called) - every send is
// caught and logged to notifications_log as 'failed' rather than thrown, the same "never let a
// side-channel failure break the main flow" principle already used for the Renter Payout
// transfer (a failed transfer lands in admin_review, it doesn't crash the request).
//
// Email is a genuinely different scope decision than SMS: SMS pricing/provider was explicitly
// confirmed (Termii, ₦5.90/transaction, passed through to the Customer as part of Admin Costs -
// see Customer Checkout Cost Breakdown), but no email cost has ever been priced or decided, so
// email notifications are logged at cost_naira = 0 here rather than guessing a number.

const config = require('../../config');
const mockProvider = require('./mockProvider');
const termiiProvider = require('./termiiProvider');
const { pool } = require('../../db/pool');

// Termii's confirmed flat per-SMS cost (config.business.smsCostNaira, the same constant
// checkoutMath.js uses to build the Admin Costs line item) - already charged to the Customer at
// checkout; logging it again here is for accounting/reconciliation, not a second charge.
const SMS_COST_NAIRA = config.business.smsCostNaira;

function provider() {
  return config.notifications.mode === 'termii' ? termiiProvider : mockProvider;
}

async function logNotification({ userId, channel, type, payload, status, costNaira }) {
  await pool.query(
    `INSERT INTO notifications_log (user_id, channel, type, payload, status, cost_naira, sent_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [userId, channel, type, JSON.stringify(payload), status, costNaira, status === 'sent' ? new Date() : null]
  );
}

async function sendSms({ userId, to, message, type }) {
  if (!to) {
    await logNotification({ userId, channel: 'sms', type, payload: { message, error: 'no phone number on file' }, status: 'failed', costNaira: 0 });
    return { status: 'failed', error: 'no phone number on file' };
  }
  try {
    const result = await provider().sendSms({ to, message });
    await logNotification({
      userId,
      channel: 'sms',
      type,
      payload: { to, message, providerReference: result.messageId },
      status: result.status === 'success' ? 'sent' : 'failed',
      costNaira: SMS_COST_NAIRA,
    });
    return result;
  } catch (err) {
    await logNotification({ userId, channel: 'sms', type, payload: { to, message, error: err.message }, status: 'failed', costNaira: 0 });
    return { status: 'failed', error: err.message };
  }
}

async function sendEmail({ userId, to, subject, variables, type }) {
  if (!to) {
    await logNotification({ userId, channel: 'email', type, payload: { subject, variables, error: 'no email on file' }, status: 'failed', costNaira: 0 });
    return { status: 'failed', error: 'no email on file' };
  }
  try {
    const result = await provider().sendEmail({ to, subject, variables });
    await logNotification({
      userId,
      channel: 'email',
      type,
      payload: { to, subject, variables, providerReference: result.messageId },
      status: result.status === 'success' ? 'sent' : 'failed',
      costNaira: 0, // no email pricing decided yet - see module header comment
    });
    return result;
  } catch (err) {
    await logNotification({ userId, channel: 'email', type, payload: { to, subject, variables, error: err.message }, status: 'failed', costNaira: 0 });
    return { status: 'failed', error: err.message };
  }
}

/**
 * Real-booking confirmation - spec/requirements-v1.md's core booking flow states this directly:
 * "After payment → Confirmation Page - full booking details ... Booking confirmation also
 * emailed and sent via SMS." Fired from bookingService.finalizeBooking's 'created' outcome.
 */
async function notifyBookingConfirmation({ user, booking, accommodationLocationText }) {
  const message =
    `TalcTech Rooms: Your booking is confirmed. Check-in ${booking.checkInDate}, ` +
    `check-out ${booking.checkOutDate} at ${accommodationLocationText}. Booking #${booking.id}.`;

  const sms = await sendSms({ userId: user.id, to: user.phone, message, type: 'booking_confirmation' });
  const email = await sendEmail({
    userId: user.id,
    to: user.email,
    subject: 'Your TalcTech Rooms booking is confirmed',
    variables: {
      full_name: user.fullName,
      booking_id: String(booking.id),
      check_in: booking.checkInDate,
      check_out: booking.checkOutDate,
      location: accommodationLocationText,
      total_charged_naira: String(booking.totalChargedNaira),
    },
    type: 'booking_confirmation',
  });
  return { sms, email };
}

/**
 * Viewing (Live or Video) confirmation - "On booking, confirmation emailed and sent via SMS" per
 * spec/requirements-v1.md > Executive Customer — Viewing Bookings.
 */
async function notifyViewingConfirmation({ user, viewing, accommodationLocationText }) {
  const kind = viewing.viewingType === 'live' ? 'Live Viewing' : 'Video Viewing';
  const message =
    `TalcTech Rooms: Your ${kind} on ${viewing.scheduledDate} at ${accommodationLocationText} ` +
    `is confirmed. Viewing #${viewing.id}.`;

  const sms = await sendSms({ userId: user.id, to: user.phone, message, type: 'viewing_confirmation' });
  const email = await sendEmail({
    userId: user.id,
    to: user.email,
    subject: `Your TalcTech Rooms ${kind.toLowerCase()} is confirmed`,
    variables: {
      full_name: user.fullName,
      viewing_id: String(viewing.id),
      viewing_type: kind,
      scheduled_date: viewing.scheduledDate,
      location: accommodationLocationText,
    },
    type: 'viewing_confirmation',
  });
  return { sms, email };
}

module.exports = { sendSms, sendEmail, notifyBookingConfirmation, notifyViewingConfirmation };
