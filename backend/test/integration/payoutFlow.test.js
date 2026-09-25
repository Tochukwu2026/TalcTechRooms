const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const createApp = require('../../src/app');
const { pool } = require('../../src/db/pool');
const { hashPassword } = require('../../src/modules/auth/passwords');
const { cleanDatabase, closeDatabase } = require('./testHelpers');
const { evaluateCheckInDayPayouts } = require('../../src/jobs/evaluateCheckInDayPayouts');
const { todayInWat } = require('../../src/modules/payout/payoutService');

// One day after todayInWat(), as a plain 'YYYY-MM-DD' string - used as checkOut whenever a test
// needs check-in to be "today" (bookings require checkOut > checkIn, and a huge date range like
// a far-future year would blow through the bookings table's NUMERIC(10,2) rent/cost columns).
function tomorrowInWat() {
  return new Date(Date.now() + 25 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

const app = createApp();

test.beforeEach(async () => {
  await cleanDatabase();
});

test.after(async () => {
  await cleanDatabase();
  await closeDatabase();
});

async function makeAdmin(email = 'admin@talctech.example') {
  const passwordHash = await hashPassword('admin-password-123');
  await pool.query(
    `INSERT INTO users (role, email, phone, password_hash, full_name)
     VALUES ('admin', $1, '08010000000', $2, 'Admin User')`,
    [email, passwordHash]
  );
  const login = await request(app).post('/auth/login').send({ email, password: 'admin-password-123' });
  return login.body.token;
}

// bankAccountNumber must NOT end in '0' unless the test wants the mock transfer to fail - see
// src/modules/payments/mockProvider.js's simulatesTransferFailure.
async function makeApprovedRenter(email = 'renter@example.com', bankAccountNumber = '0123456781') {
  const passwordHash = await hashPassword('super-secret-1');
  const userResult = await pool.query(
    `INSERT INTO users (role, email, phone, password_hash, full_name)
     VALUES ('renter', $1, '08010000000', $2, 'A Renter') RETURNING id`,
    [email, passwordHash]
  );
  const userId = userResult.rows[0].id;
  await pool.query(
    `INSERT INTO renters (user_id, address, approval_status, bank_name, bank_account_number, bank_account_name)
     VALUES ($1, '1 Rd, Lagos', 'approved', 'GTBank', $2, 'A Renter')`,
    [userId, bankAccountNumber]
  );
  const login = await request(app).post('/auth/login').send({ email, password: 'super-secret-1' });
  return { userId, token: login.body.token };
}

async function createListing(token, overrides = {}) {
  const payload = {
    type: 'studio',
    state: 'Lagos',
    area: 'Lekki',
    locationText: 'Lekki Phase 1, off Admiralty Way',
    description: 'A lovely studio apartment close to the beach.',
    contactInfo: '+2348010000000',
    numberOfUnits: 3,
    nightlyRentNaira: 20000,
    ...overrides,
  };
  const res = await request(app).post('/accommodations').set('Authorization', `Bearer ${token}`).send(payload);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.id;
}

async function registerCustomer(email = 'jane@example.com', overrides = {}) {
  const payload = {
    email,
    phone: '08020000000',
    fullName: 'Jane Customer',
    password: 'super-secret-1',
    documentType: 'nin',
    documentNumber: '12345678901',
    ...overrides,
  };
  const res = await request(app).post('/customers/register').send(payload);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const login = await request(app).post('/auth/login').send({ email, password: payload.password });
  return { userId: res.body.user.id, token: login.body.token };
}

// Creates and pays for a booking, returning its id + the Customer's token. `checkIn`/`checkOut`
// default a couple of days out so tests that need a >=7-day-refundable window can override them.
async function createPaidBooking(renterToken, customerToken, { checkIn = '2026-10-05', checkOut = '2026-10-06' } = {}) {
  const listingId = await createListing(renterToken);
  const init = await request(app)
    .post(`/accommodations/${listingId}/bookings/initialize`)
    .set('Authorization', `Bearer ${customerToken}`)
    .send({ checkIn, checkOut, units: 1 });
  assert.equal(init.status, 201, JSON.stringify(init.body));
  const verify = await request(app)
    .post(`/bookings/verify/${init.body.reference}`)
    .set('Authorization', `Bearer ${customerToken}`)
    .send();
  assert.equal(verify.status, 201, JSON.stringify(verify.body));
  return verify.body.id;
}

test('Path A: confirming check-in releases the payout immediately', async () => {
  const { token: renterToken } = await makeApprovedRenter();
  const { token: customerToken } = await registerCustomer();
  const bookingId = await createPaidBooking(renterToken, customerToken);

  const res = await request(app)
    .post(`/bookings/${bookingId}/confirm-check-in`)
    .set('Authorization', `Bearer ${customerToken}`)
    .send();
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.status, 'checked_in_confirmed');
  assert.equal(res.body.payoutStatus, 'released');

  const { rows } = await pool.query('SELECT status, payout_status, paystack_transfer_reference FROM bookings WHERE id = $1', [
    bookingId,
  ]);
  assert.equal(rows[0].status, 'checked_in_confirmed');
  assert.equal(rows[0].payout_status, 'released');
  assert.ok(rows[0].paystack_transfer_reference);
});

test('Path A: reporting a problem holds the payout and opens an admin review case', async () => {
  const { token: renterToken } = await makeApprovedRenter();
  const { token: customerToken } = await registerCustomer();
  const bookingId = await createPaidBooking(renterToken, customerToken);

  const res = await request(app)
    .post(`/bookings/${bookingId}/report-problem`)
    .set('Authorization', `Bearer ${customerToken}`)
    .send({ notes: 'This listing does not match the photos.' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.status, 'fraud_reported');
  assert.equal(res.body.payoutStatus, 'held');

  const { rows } = await pool.query(
    `SELECT reason, status, notes FROM admin_review_cases WHERE booking_id = $1`,
    [bookingId]
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].reason, 'fraud_report');
  assert.equal(rows[0].status, 'open');
});

test('Path A: admin resolving a review case as release_payout pays the Renter', async () => {
  const { token: renterToken } = await makeApprovedRenter();
  const { token: customerToken } = await registerCustomer();
  const adminToken = await makeAdmin();
  const bookingId = await createPaidBooking(renterToken, customerToken);

  await request(app)
    .post(`/bookings/${bookingId}/report-problem`)
    .set('Authorization', `Bearer ${customerToken}`)
    .send({});

  const list = await request(app).get('/admin/review-cases').set('Authorization', `Bearer ${adminToken}`);
  assert.equal(list.status, 200);
  assert.equal(list.body.length, 1);
  const caseId = list.body[0].id;

  const resolve = await request(app)
    .patch(`/admin/review-cases/${caseId}/resolve`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ resolution: 'release_payout' });
  assert.equal(resolve.status, 200, JSON.stringify(resolve.body));
  assert.equal(resolve.body.payoutStatus, 'released');

  const { rows } = await pool.query('SELECT payout_status FROM bookings WHERE id = $1', [bookingId]);
  assert.equal(rows[0].payout_status, 'released');
});

test('Path A: admin resolving a review case as refund_customer refunds the Rent portion only, no payout', async () => {
  const { token: renterToken } = await makeApprovedRenter();
  const { token: customerToken } = await registerCustomer();
  const adminToken = await makeAdmin();
  const bookingId = await createPaidBooking(renterToken, customerToken);

  await request(app)
    .post(`/bookings/${bookingId}/report-problem`)
    .set('Authorization', `Bearer ${customerToken}`)
    .send({});

  const list = await request(app).get('/admin/review-cases').set('Authorization', `Bearer ${adminToken}`);
  const caseId = list.body[0].id;

  const resolve = await request(app)
    .patch(`/admin/review-cases/${caseId}/resolve`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ resolution: 'refund_customer', notes: 'Confirmed the listing does not exist.' });
  assert.equal(resolve.status, 200, JSON.stringify(resolve.body));
  assert.equal(resolve.body.payoutStatus, 'not_applicable');
  assert.equal(resolve.body.refundedRentNaira, 20000);

  const { rows: bookingRows } = await pool.query('SELECT status, payout_status FROM bookings WHERE id = $1', [
    bookingId,
  ]);
  assert.equal(bookingRows[0].status, 'canceled_no_refund');
  assert.equal(bookingRows[0].payout_status, 'not_applicable');

  const { rows: refundRows } = await pool.query('SELECT amount_naira, reason FROM refunds WHERE booking_id = $1', [
    bookingId,
  ]);
  assert.equal(refundRows.length, 1);
  assert.equal(Number(refundRows[0].amount_naira), 20000);
  assert.equal(refundRows[0].reason, 'fraud_confirmed');

  const { rows: caseRows } = await pool.query('SELECT status FROM admin_review_cases WHERE id = $1', [caseId]);
  assert.equal(caseRows[0].status, 'resolved');
});

test('9pm evaluation job flags a still-held, still-active booking whose check-in date has passed', async () => {
  const { token: renterToken } = await makeApprovedRenter();
  const { token: customerToken } = await registerCustomer();
  // check-in date is "today" (WAT) - neither confirmed nor reported - the job should catch it.
  const bookingId = await createPaidBooking(renterToken, customerToken, {
    checkIn: todayInWat(),
    checkOut: tomorrowInWat(),
  });

  const result = await evaluateCheckInDayPayouts();
  assert.ok(result.flaggedBookingIds.includes(bookingId));

  const { rows } = await pool.query('SELECT status, payout_status FROM bookings WHERE id = $1', [bookingId]);
  assert.equal(rows[0].status, 'active'); // job only flags, never changes booking status itself
  assert.equal(rows[0].payout_status, 'admin_review');

  const { rows: caseRows } = await pool.query(
    `SELECT reason, status FROM admin_review_cases WHERE booking_id = $1`,
    [bookingId]
  );
  assert.equal(caseRows.length, 1);
  assert.equal(caseRows[0].reason, 'no_show_no_response');
});

test('9pm evaluation job leaves a confirmed booking alone', async () => {
  const { token: renterToken } = await makeApprovedRenter();
  const { token: customerToken } = await registerCustomer();
  const bookingId = await createPaidBooking(renterToken, customerToken, {
    checkIn: todayInWat(),
    checkOut: tomorrowInWat(),
  });

  await request(app)
    .post(`/bookings/${bookingId}/confirm-check-in`)
    .set('Authorization', `Bearer ${customerToken}`)
    .send();

  const result = await evaluateCheckInDayPayouts();
  assert.ok(!result.flaggedBookingIds.includes(bookingId));

  const { rows } = await pool.query('SELECT status, payout_status FROM bookings WHERE id = $1', [bookingId]);
  assert.equal(rows[0].status, 'checked_in_confirmed');
  assert.equal(rows[0].payout_status, 'released');
});

test('Path B: cancelling within the no-refund window (<7 days before check-in) releases the payout instantly, no refund row', async () => {
  const { token: renterToken } = await makeApprovedRenter();
  const { token: customerToken } = await registerCustomer();
  // 2 days out - inside the <7-day no-refund window regardless of what "today" actually is.
  const nearCheckIn = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const nearCheckOut = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const bookingId = await createPaidBooking(renterToken, customerToken, {
    checkIn: nearCheckIn,
    checkOut: nearCheckOut,
  });

  const res = await request(app)
    .post(`/bookings/${bookingId}/cancel`)
    .set('Authorization', `Bearer ${customerToken}`)
    .send();
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.status, 'canceled_no_refund');
  assert.equal(res.body.payoutStatus, 'released');

  const { rows } = await pool.query('SELECT status, payout_status FROM bookings WHERE id = $1', [bookingId]);
  assert.equal(rows[0].status, 'canceled_no_refund');
  assert.equal(rows[0].payout_status, 'released');

  const { rows: refundRows } = await pool.query('SELECT count(*)::int AS n FROM refunds WHERE booking_id = $1', [
    bookingId,
  ]);
  assert.equal(refundRows[0].n, 0);
});

test('Path B: cancelling >=7 days before check-in refunds the Rent portion only, no payout', async () => {
  const { token: renterToken } = await makeApprovedRenter();
  const { token: customerToken } = await registerCustomer();
  const farFutureCheckIn = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const farFutureCheckOut = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const bookingId = await createPaidBooking(renterToken, customerToken, {
    checkIn: farFutureCheckIn,
    checkOut: farFutureCheckOut,
  });

  const res = await request(app)
    .post(`/bookings/${bookingId}/cancel`)
    .set('Authorization', `Bearer ${customerToken}`)
    .send();
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.status, 'canceled_refundable');
  assert.equal(res.body.payoutStatus, 'not_applicable');
  assert.equal(res.body.refundedRentNaira, 20000);

  const { rows } = await pool.query('SELECT status, payout_status, paystack_transfer_reference FROM bookings WHERE id = $1', [
    bookingId,
  ]);
  assert.equal(rows[0].status, 'canceled_refundable');
  assert.equal(rows[0].payout_status, 'not_applicable');
  assert.equal(rows[0].paystack_transfer_reference, null);

  const { rows: refundRows } = await pool.query('SELECT amount_naira, reason FROM refunds WHERE booking_id = $1', [
    bookingId,
  ]);
  assert.equal(refundRows.length, 1);
  assert.equal(Number(refundRows[0].amount_naira), 20000);
  assert.equal(refundRows[0].reason, 'customer_cancellation');
});

test('A mock transfer failure (bank account ending in 0) lands the booking in admin_review rather than silently failing', async () => {
  const { token: renterToken } = await makeApprovedRenter('failrenter@example.com', '0123456780');
  const { token: customerToken } = await registerCustomer();
  const bookingId = await createPaidBooking(renterToken, customerToken);

  const res = await request(app)
    .post(`/bookings/${bookingId}/confirm-check-in`)
    .set('Authorization', `Bearer ${customerToken}`)
    .send();
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.payoutStatus, 'admin_review');

  const { rows } = await pool.query('SELECT payout_status FROM bookings WHERE id = $1', [bookingId]);
  assert.equal(rows[0].payout_status, 'admin_review');

  const { rows: caseRows } = await pool.query(
    `SELECT reason, status FROM admin_review_cases WHERE booking_id = $1`,
    [bookingId]
  );
  assert.equal(caseRows.length, 1);
  assert.equal(caseRows[0].reason, 'other');
});

test('A Renter cannot confirm check-in on a booking (customer-only route)', async () => {
  const { token: renterToken } = await makeApprovedRenter();
  const { token: customerToken } = await registerCustomer();
  const bookingId = await createPaidBooking(renterToken, customerToken);

  const res = await request(app)
    .post(`/bookings/${bookingId}/confirm-check-in`)
    .set('Authorization', `Bearer ${renterToken}`)
    .send();
  assert.equal(res.status, 403);
});

test('A Customer cannot confirm check-in on another Customer\'s booking', async () => {
  const { token: renterToken } = await makeApprovedRenter();
  const { token: customer1Token } = await registerCustomer('owner@example.com');
  const { token: customer2Token } = await registerCustomer('stranger@example.com');
  const bookingId = await createPaidBooking(renterToken, customer1Token);

  const res = await request(app)
    .post(`/bookings/${bookingId}/confirm-check-in`)
    .set('Authorization', `Bearer ${customer2Token}`)
    .send();
  assert.equal(res.status, 403);
});

test('Confirming check-in twice is rejected the second time (booking is no longer active)', async () => {
  const { token: renterToken } = await makeApprovedRenter();
  const { token: customerToken } = await registerCustomer();
  const bookingId = await createPaidBooking(renterToken, customerToken);

  await request(app).post(`/bookings/${bookingId}/confirm-check-in`).set('Authorization', `Bearer ${customerToken}`).send();
  const second = await request(app)
    .post(`/bookings/${bookingId}/confirm-check-in`)
    .set('Authorization', `Bearer ${customerToken}`)
    .send();
  assert.equal(second.status, 409);
});

test('Renter can update their own bank details', async () => {
  const { token: renterToken } = await makeApprovedRenter();
  const res = await request(app)
    .patch('/renters/me/bank-details')
    .set('Authorization', `Bearer ${renterToken}`)
    .send({ bankName: 'Zenith Bank', bankAccountNumber: '0987654321', bankAccountName: 'A Renter' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.bank_name, 'Zenith Bank');
  assert.equal(res.body.bank_account_number, '0987654321');
});
