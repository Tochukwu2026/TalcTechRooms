// Executive Feature Viewing bookings (Live Viewing / Video Viewing) - see spec/requirements-v1.md
// > Executive Customer — Viewing Bookings (Phase 1) and spec/decisions-and-phasing.md > Build
// Phasing. Schema (viewing_bookings, viewing_availability) already existed from Phase 1 - see
// src/db/migrations/0005_price_caps_and_accommodations.up.sql and
// 0007_viewing_bookings_and_notifications.up.sql - so no new migration is needed here.
//
// Scope for this pass, per the founder's explicit choice (2026-09-25): backend only (booking +
// quota rules + Admin/Staff assignment endpoints), no new Admin-dashboard UI page yet. Email/SMS
// confirmations (the spec's "confirmation emailed and sent via SMS") are NOT sent here, for the
// same reason booking creation doesn't send them either - Termii isn't wired up to anything yet
// anywhere in this codebase (mock notification module doesn't exist; only the notifications_log
// table does) - so this stays consistent with the rest of the app rather than being a special
// case. Revisit once Termii is actually integrated.
//
// Gating: "Executive Feature Booking Tab" is spec'd as "active only for Executive Customers;
// dead/disabled for Regular Customers" - enforced here as a hard 403 on both the availability
// lookups and the booking action (not just a disabled button), since the backend can't rely on
// the app's UI to enforce this. Does NOT additionally require ID verification to have passed -
// unlike real booking creation, a viewing is not a monetary transaction and the spec doesn't
// call for this gate, so it isn't added here as it was for bookingService.assertCustomerIdVerified.

const { pool, withTransaction } = require('../../db/pool');
const ApiError = require('../../utils/ApiError');

const VIDEO_WINDOW_DAYS = 30; // "Shows availability for the next 30 days for that listing."
const VIDEO_WEEKLY_LIMIT_DAYS = 7; // "1 Video Viewing per location per week" - measured from the
// customer's most recent (non-cancelled) booking for that listing, not from the scheduled date
// itself - the founder's explicit choice (2026-09-25) over a calendar-week definition.
const LIVE_TOTAL_MONTHLY_LIMIT = 3; // "3 Live Viewings total per month across all listings"

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function addDaysIso(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 'YYYY-MM' for a plain 'YYYY-MM-DD' string - used to compare "same calendar month" for the
 * Live Viewing monthly limits, which the spec states in calendar-month terms ("per month"),
 * unlike the video weekly limit (which the founder chose to measure as a rolling window instead
 * - see VIDEO_WEEKLY_LIMIT_DAYS above). */
function monthOf(isoDate) {
  return isoDate.slice(0, 7);
}

async function assertExecutiveCustomer(client, customerUserId) {
  const { rows } = await client.query('SELECT tier FROM customers WHERE user_id = $1', [customerUserId]);
  if (rows.length === 0) {
    throw new ApiError(404, 'Customer account not found.');
  }
  if (rows[0].tier !== 'executive') {
    throw new ApiError(
      403,
      'Executive Feature Viewings (Live/Video) are only available to Executive Customers.'
    );
  }
}

async function assertAccommodationActive(client, accommodationId) {
  const { rows } = await client.query('SELECT id FROM accommodations WHERE id = $1 AND is_active = true', [
    accommodationId,
  ]);
  if (rows.length === 0) {
    throw new ApiError(404, 'Accommodation not found.');
  }
}

/**
 * Video Viewing availability: per spec, just "the next 30 days for that listing" - no
 * Renter-marked restriction (unlike Live Viewing below), so this is a plain calendar list, not a
 * DB query against per-date rows. The actual weekly-limit check happens at booking time, not
 * here - a date isn't "unavailable" for other reasons the way a Live Viewing date can be.
 */
async function getVideoAvailability(accommodationId, customerUserId) {
  await assertExecutiveCustomer(pool, customerUserId);
  await assertAccommodationActive(pool, accommodationId);

  const start = todayIso();
  const dates = [];
  for (let i = 0; i < VIDEO_WINDOW_DAYS; i += 1) {
    dates.push(addDaysIso(start, i));
  }
  return { viewingType: 'video', dates };
}

/**
 * Live Viewing availability: only the specific dates the Renter marked (viewing_availability)
 * that aren't already booked by someone else - everything else is "dead/unselectable" per spec.
 */
async function getLiveAvailability(accommodationId, customerUserId) {
  await assertExecutiveCustomer(pool, customerUserId);
  await assertAccommodationActive(pool, accommodationId);

  const { rows } = await pool.query(
    `SELECT available_date FROM viewing_availability
     WHERE accommodation_id = $1 AND is_booked = false AND available_date >= $2
     ORDER BY available_date ASC`,
    [accommodationId, todayIso()]
  );
  return { viewingType: 'live', dates: rows.map((r) => r.available_date) };
}

async function assertVideoWeeklyLimit(client, customerUserId, accommodationId) {
  const { rows } = await client.query(
    `SELECT created_at FROM viewing_bookings
     WHERE customer_user_id = $1 AND accommodation_id = $2 AND viewing_type = 'video' AND status != 'cancelled'
     ORDER BY created_at DESC
     LIMIT 1`,
    [customerUserId, accommodationId]
  );
  if (rows.length === 0) return;

  const lastBookedAt = new Date(rows[0].created_at);
  const cutoff = new Date(Date.now() - VIDEO_WEEKLY_LIMIT_DAYS * 24 * 60 * 60 * 1000);
  if (lastBookedAt >= cutoff) {
    throw new ApiError(409, 'You have exceeded your weekly limit for this location.');
  }
}

async function assertLiveMonthlyLimits(client, customerUserId, accommodationId, scheduledDate) {
  const month = monthOf(scheduledDate);

  const perListing = await client.query(
    `SELECT 1 FROM viewing_bookings
     WHERE customer_user_id = $1 AND accommodation_id = $2 AND viewing_type = 'live'
       AND status != 'cancelled' AND to_char(scheduled_date, 'YYYY-MM') = $3
     LIMIT 1`,
    [customerUserId, accommodationId, month]
  );
  if (perListing.rows.length > 0) {
    throw new ApiError(409, 'You have already booked a Live Viewing for this listing this month.');
  }

  const totalThisMonth = await client.query(
    `SELECT count(*)::int AS n FROM viewing_bookings
     WHERE customer_user_id = $1 AND viewing_type = 'live'
       AND status != 'cancelled' AND to_char(scheduled_date, 'YYYY-MM') = $2`,
    [customerUserId, month]
  );
  if (totalThisMonth.rows[0].n >= LIVE_TOTAL_MONTHLY_LIMIT) {
    throw new ApiError(409, `You have reached your limit of ${LIVE_TOTAL_MONTHLY_LIMIT} Live Viewings this month.`);
  }
}

function toViewingResponse(row) {
  return {
    id: row.id,
    customerUserId: row.customer_user_id,
    accommodationId: row.accommodation_id,
    viewingType: row.viewing_type,
    scheduledDate: row.scheduled_date,
    status: row.status,
    assignedStaffUserId: row.assigned_staff_user_id,
    createdAt: row.created_at,
  };
}

/**
 * Books a Live or Video Viewing for an Executive Customer. Video: 30-day window + rolling
 * 7-day-per-listing limit, no exclusivity between customers. Live: must be one of the Renter's
 * marked, still-unbooked dates + the two monthly caps, AND is exclusive - booking it makes it
 * dead for every other Executive Customer (enforced both by an application check and by the
 * partial unique index on viewing_bookings, so a race between two simultaneous requests for the
 * same listing/date can't double-book it).
 */
async function bookViewing(customerUserId, accommodationId, { viewingType, scheduledDate }) {
  return withTransaction(async (client) => {
    await assertExecutiveCustomer(client, customerUserId);
    await assertAccommodationActive(client, accommodationId);

    if (viewingType === 'video') {
      const maxDate = addDaysIso(todayIso(), VIDEO_WINDOW_DAYS - 1);
      if (scheduledDate < todayIso() || scheduledDate > maxDate) {
        throw new ApiError(400, `"${scheduledDate}" is outside the 30-day Video Viewing window for this listing.`);
      }
      await assertVideoWeeklyLimit(client, customerUserId, accommodationId);

      const { rows } = await client.query(
        `INSERT INTO viewing_bookings (customer_user_id, accommodation_id, viewing_type, scheduled_date)
         VALUES ($1, $2, 'video', $3)
         RETURNING *`,
        [customerUserId, accommodationId, scheduledDate]
      );
      return toViewingResponse(rows[0]);
    }

    if (viewingType === 'live') {
      // Lock the availability row first so a concurrent request for the same date sees a
      // consistent is_booked value before either commits.
      const availabilityRow = await client.query(
        `SELECT is_booked FROM viewing_availability
         WHERE accommodation_id = $1 AND available_date = $2
         FOR UPDATE`,
        [accommodationId, scheduledDate]
      );
      if (availabilityRow.rows.length === 0) {
        throw new ApiError(404, 'That date is not marked as available for a Live Viewing on this listing.');
      }
      if (availabilityRow.rows[0].is_booked) {
        throw new ApiError(409, 'That date has already been booked by another Executive Customer.');
      }

      await assertLiveMonthlyLimits(client, customerUserId, accommodationId, scheduledDate);

      const { rows } = await client.query(
        `INSERT INTO viewing_bookings (customer_user_id, accommodation_id, viewing_type, scheduled_date)
         VALUES ($1, $2, 'live', $3)
         RETURNING *`,
        [customerUserId, accommodationId, scheduledDate]
      );
      await client.query(
        `UPDATE viewing_availability SET is_booked = true WHERE accommodation_id = $1 AND available_date = $2`,
        [accommodationId, scheduledDate]
      );
      return toViewingResponse(rows[0]);
    }

    // Unreachable given Zod validation, but defensive against a future caller bypassing it.
    throw new ApiError(400, `Unknown viewing type "${viewingType}".`);
  });
}

async function listMyViewings(customerUserId) {
  const { rows } = await pool.query(
    `SELECT * FROM viewing_bookings WHERE customer_user_id = $1 ORDER BY scheduled_date DESC`,
    [customerUserId]
  );
  return rows.map(toViewingResponse);
}

/**
 * Cancels the Customer's own viewing. For a Live Viewing, also frees the date back up
 * (is_booked = false) so another Executive Customer (or the same one again) can book it - the
 * spec doesn't say this explicitly, but leaving a cancelled booking's date permanently dead
 * would make an accidental/cancelled booking waste a Renter-marked date forever, which seems
 * clearly unintended.
 */
async function cancelViewing(viewingId, customerUserId) {
  return withTransaction(async (client) => {
    const { rows } = await client.query('SELECT * FROM viewing_bookings WHERE id = $1', [viewingId]);
    if (rows.length === 0) {
      throw new ApiError(404, 'Viewing not found.');
    }
    const viewing = rows[0];
    if (String(viewing.customer_user_id) !== String(customerUserId)) {
      throw new ApiError(403, 'You do not have permission to cancel this viewing.');
    }
    if (viewing.status !== 'scheduled') {
      throw new ApiError(409, `This viewing is '${viewing.status}' and can no longer be cancelled.`);
    }

    await client.query(`UPDATE viewing_bookings SET status = 'cancelled' WHERE id = $1`, [viewingId]);
    if (viewing.viewing_type === 'live') {
      await client.query(
        `UPDATE viewing_availability SET is_booked = false
         WHERE accommodation_id = $1 AND available_date = $2`,
        [viewing.accommodation_id, viewing.scheduled_date]
      );
    }
    return { id: viewingId, status: 'cancelled' };
  });
}

// --- Admin / Staff side ---

/**
 * Lists viewings for the Admin dashboard's assignment queue. `unassignedOnly` narrows to
 * bookings still needing a staff member, the common case for an assignment view.
 */
async function listViewingsForAdmin({ status, unassignedOnly } = {}) {
  const conditions = [];
  const params = [];
  if (status) {
    params.push(status);
    conditions.push(`vb.status = $${params.length}`);
  }
  if (unassignedOnly) {
    conditions.push('vb.assigned_staff_user_id IS NULL');
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows } = await pool.query(
    `SELECT vb.*, a.location_text, a.type AS accommodation_type
     FROM viewing_bookings vb
     JOIN accommodations a ON a.id = vb.accommodation_id
     ${where}
     ORDER BY vb.scheduled_date ASC`,
    params
  );
  return rows.map((row) => ({
    ...toViewingResponse(row),
    accommodationLocationText: row.location_text,
    accommodationType: row.accommodation_type,
  }));
}

async function assignStaff(viewingId, staffUserId) {
  return withTransaction(async (client) => {
    const staffRow = await client.query('SELECT id FROM users WHERE id = $1 AND role = $2', [staffUserId, 'staff']);
    if (staffRow.rows.length === 0) {
      throw new ApiError(404, 'Staff user not found.');
    }

    const { rows } = await client.query('SELECT * FROM viewing_bookings WHERE id = $1', [viewingId]);
    if (rows.length === 0) {
      throw new ApiError(404, 'Viewing not found.');
    }
    if (rows[0].status !== 'scheduled') {
      throw new ApiError(409, `This viewing is '${rows[0].status}' and can no longer be assigned.`);
    }

    const updated = await client.query(
      `UPDATE viewing_bookings SET assigned_staff_user_id = $2 WHERE id = $1 RETURNING *`,
      [viewingId, staffUserId]
    );
    return toViewingResponse(updated.rows[0]);
  });
}

async function listMyAssignedViewings(staffUserId) {
  const { rows } = await pool.query(
    `SELECT vb.*, a.location_text, a.type AS accommodation_type
     FROM viewing_bookings vb
     JOIN accommodations a ON a.id = vb.accommodation_id
     WHERE vb.assigned_staff_user_id = $1
     ORDER BY vb.scheduled_date ASC`,
    [staffUserId]
  );
  return rows.map((row) => ({
    ...toViewingResponse(row),
    accommodationLocationText: row.location_text,
    accommodationType: row.accommodation_type,
  }));
}

async function markViewingComplete(viewingId, staffUserId) {
  const { rows } = await pool.query('SELECT * FROM viewing_bookings WHERE id = $1', [viewingId]);
  if (rows.length === 0) {
    throw new ApiError(404, 'Viewing not found.');
  }
  const viewing = rows[0];
  if (String(viewing.assigned_staff_user_id) !== String(staffUserId)) {
    throw new ApiError(403, 'This viewing is not assigned to you.');
  }
  if (viewing.status !== 'scheduled') {
    throw new ApiError(409, `This viewing is '${viewing.status}' and cannot be marked complete.`);
  }

  const updated = await pool.query(
    `UPDATE viewing_bookings SET status = 'completed' WHERE id = $1 RETURNING *`,
    [viewingId]
  );
  return toViewingResponse(updated.rows[0]);
}

module.exports = {
  getVideoAvailability,
  getLiveAvailability,
  bookViewing,
  listMyViewings,
  cancelViewing,
  listViewingsForAdmin,
  assignStaff,
  listMyAssignedViewings,
  markViewingComplete,
};
