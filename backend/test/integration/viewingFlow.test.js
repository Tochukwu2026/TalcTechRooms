const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const createApp = require('../../src/app');
const { pool } = require('../../src/db/pool');
const { hashPassword } = require('../../src/modules/auth/passwords');
const { cleanDatabase, closeDatabase } = require('./testHelpers');

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

async function makeStaff(email = 'staff@talctech.example') {
  const passwordHash = await hashPassword('staff-password-123');
  const { rows } = await pool.query(
    `INSERT INTO users (role, email, phone, password_hash, full_name)
     VALUES ('staff', $1, '08010000000', $2, 'Staff Member') RETURNING id`,
    [email, passwordHash]
  );
  const login = await request(app).post('/auth/login').send({ email, password: 'staff-password-123' });
  return { userId: rows[0].id, token: login.body.token };
}

async function makeApprovedRenter(email = 'renter@example.com') {
  const passwordHash = await hashPassword('super-secret-1');
  const userResult = await pool.query(
    `INSERT INTO users (role, email, phone, password_hash, full_name)
     VALUES ('renter', $1, '08010000000', $2, 'A Renter') RETURNING id`,
    [email, passwordHash]
  );
  const userId = userResult.rows[0].id;
  await pool.query(
    `INSERT INTO renters (user_id, address, approval_status) VALUES ($1, '1 Rd, Lagos', 'approved')`,
    [userId]
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

async function registerCustomer(email = 'exec@example.com', overrides = {}) {
  const payload = {
    email,
    phone: '08020000000',
    fullName: 'Jane Customer',
    password: 'super-secret-1',
    documentType: 'nin',
    documentNumber: '12345678901',
    tier: 'executive',
    ...overrides,
  };
  const res = await request(app).post('/customers/register').send(payload);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const login = await request(app).post('/auth/login').send({ email, password: payload.password });
  return { userId: res.body.user.id, token: login.body.token };
}

function tomorrowIso() {
  return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

test('Executive Customer can book a Video Viewing within the 30-day window', async () => {
  const { token: renterToken } = await makeApprovedRenter();
  const listingId = await createListing(renterToken);
  const { token: execToken } = await registerCustomer();

  const availability = await request(app)
    .get(`/accommodations/${listingId}/viewings/video-availability`)
    .set('Authorization', `Bearer ${execToken}`);
  assert.equal(availability.status, 200);
  assert.equal(availability.body.dates.length, 30);

  const book = await request(app)
    .post(`/accommodations/${listingId}/viewings`)
    .set('Authorization', `Bearer ${execToken}`)
    .send({ viewingType: 'video', scheduledDate: tomorrowIso() });
  assert.equal(book.status, 201, JSON.stringify(book.body));
  assert.equal(book.body.viewingType, 'video');
  assert.equal(book.body.status, 'scheduled');
});

test('A Regular Customer is blocked (403) from Executive Feature Viewings', async () => {
  const { token: renterToken } = await makeApprovedRenter();
  const listingId = await createListing(renterToken);
  const { token: regularToken } = await registerCustomer('regular@example.com', { tier: 'regular' });

  const availability = await request(app)
    .get(`/accommodations/${listingId}/viewings/video-availability`)
    .set('Authorization', `Bearer ${regularToken}`);
  assert.equal(availability.status, 403);

  const book = await request(app)
    .post(`/accommodations/${listingId}/viewings`)
    .set('Authorization', `Bearer ${regularToken}`)
    .send({ viewingType: 'video', scheduledDate: tomorrowIso() });
  assert.equal(book.status, 403);
});

test('A second Video Viewing for the same listing within 7 days is rejected with the exact spec message', async () => {
  const { token: renterToken } = await makeApprovedRenter();
  const listingId = await createListing(renterToken);
  const { token: execToken } = await registerCustomer();

  const first = await request(app)
    .post(`/accommodations/${listingId}/viewings`)
    .set('Authorization', `Bearer ${execToken}`)
    .send({ viewingType: 'video', scheduledDate: tomorrowIso() });
  assert.equal(first.status, 201);

  const second = await request(app)
    .post(`/accommodations/${listingId}/viewings`)
    .set('Authorization', `Bearer ${execToken}`)
    .send({ viewingType: 'video', scheduledDate: tomorrowIso() });
  assert.equal(second.status, 409);
  assert.equal(second.body.error, 'You have exceeded your weekly limit for this location.');
});

test('A Video Viewing is allowed again once the last booking is more than 7 days old', async () => {
  const { token: renterToken } = await makeApprovedRenter();
  const listingId = await createListing(renterToken);
  const { token: execToken } = await registerCustomer();

  const first = await request(app)
    .post(`/accommodations/${listingId}/viewings`)
    .set('Authorization', `Bearer ${execToken}`)
    .send({ viewingType: 'video', scheduledDate: tomorrowIso() });
  assert.equal(first.status, 201);

  // Simulate the first booking having happened over a week ago.
  await pool.query(`UPDATE viewing_bookings SET created_at = now() - interval '8 days' WHERE id = $1`, [
    first.body.id,
  ]);

  const second = await request(app)
    .post(`/accommodations/${listingId}/viewings`)
    .set('Authorization', `Bearer ${execToken}`)
    .send({ viewingType: 'video', scheduledDate: tomorrowIso() });
  assert.equal(second.status, 201, JSON.stringify(second.body));
});

test('There is no cap on Video Viewings across different listings within the same week', async () => {
  const { token: renterToken } = await makeApprovedRenter();
  const listing1 = await createListing(renterToken);
  const listing2 = await createListing(renterToken);
  const { token: execToken } = await registerCustomer();

  const first = await request(app)
    .post(`/accommodations/${listing1}/viewings`)
    .set('Authorization', `Bearer ${execToken}`)
    .send({ viewingType: 'video', scheduledDate: tomorrowIso() });
  assert.equal(first.status, 201);

  const second = await request(app)
    .post(`/accommodations/${listing2}/viewings`)
    .set('Authorization', `Bearer ${execToken}`)
    .send({ viewingType: 'video', scheduledDate: tomorrowIso() });
  assert.equal(second.status, 201);
});

test('Live Viewing: booking a Renter-marked date works and removes it from availability for others', async () => {
  const { token: renterToken } = await makeApprovedRenter();
  const listingId = await createListing(renterToken);
  const liveDate = tomorrowIso();
  await request(app)
    .post(`/accommodations/${listingId}/viewing-availability`)
    .set('Authorization', `Bearer ${renterToken}`)
    .send({ dates: [liveDate] });

  const { token: exec1Token } = await registerCustomer('exec1@example.com');
  const { token: exec2Token } = await registerCustomer('exec2@example.com');

  const before = await request(app)
    .get(`/accommodations/${listingId}/viewings/live-availability`)
    .set('Authorization', `Bearer ${exec1Token}`);
  assert.deepEqual(before.body.dates, [liveDate]);

  const book1 = await request(app)
    .post(`/accommodations/${listingId}/viewings`)
    .set('Authorization', `Bearer ${exec1Token}`)
    .send({ viewingType: 'live', scheduledDate: liveDate });
  assert.equal(book1.status, 201, JSON.stringify(book1.body));

  const after = await request(app)
    .get(`/accommodations/${listingId}/viewings/live-availability`)
    .set('Authorization', `Bearer ${exec1Token}`);
  assert.deepEqual(after.body.dates, []);

  const book2 = await request(app)
    .post(`/accommodations/${listingId}/viewings`)
    .set('Authorization', `Bearer ${exec2Token}`)
    .send({ viewingType: 'live', scheduledDate: liveDate });
  assert.equal(book2.status, 409);
});

test('Live Viewing: booking a date the Renter never marked is rejected (404)', async () => {
  const { token: renterToken } = await makeApprovedRenter();
  const listingId = await createListing(renterToken);
  const { token: execToken } = await registerCustomer();

  const book = await request(app)
    .post(`/accommodations/${listingId}/viewings`)
    .set('Authorization', `Bearer ${execToken}`)
    .send({ viewingType: 'live', scheduledDate: tomorrowIso() });
  assert.equal(book.status, 404);
});

test('Live Viewing: at most 1 per listing per month for the same Executive Customer', async () => {
  const { token: renterToken } = await makeApprovedRenter();
  const listingId = await createListing(renterToken);
  const { token: execToken } = await registerCustomer();

  const day1 = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const day2 = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  await request(app)
    .post(`/accommodations/${listingId}/viewing-availability`)
    .set('Authorization', `Bearer ${renterToken}`)
    .send({ dates: [day1, day2] });

  const first = await request(app)
    .post(`/accommodations/${listingId}/viewings`)
    .set('Authorization', `Bearer ${execToken}`)
    .send({ viewingType: 'live', scheduledDate: day1 });
  assert.equal(first.status, 201);

  const second = await request(app)
    .post(`/accommodations/${listingId}/viewings`)
    .set('Authorization', `Bearer ${execToken}`)
    .send({ viewingType: 'live', scheduledDate: day2 });
  assert.equal(second.status, 409);
  assert.match(second.body.error, /already booked a Live Viewing for this listing this month/);
});

test('Live Viewing: at most 3 total per month across all listings for the same Executive Customer', async () => {
  const { token: renterToken } = await makeApprovedRenter();
  const { token: execToken } = await registerCustomer();

  const listingIds = [];
  const dates = [];
  for (let i = 0; i < 4; i += 1) {
    const listingId = await createListing(renterToken);
    listingIds.push(listingId);
    const date = new Date(Date.now() + (2 + i) * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    dates.push(date);
    await request(app)
      .post(`/accommodations/${listingId}/viewing-availability`)
      .set('Authorization', `Bearer ${renterToken}`)
      .send({ dates: [date] });
  }

  for (let i = 0; i < 3; i += 1) {
    const res = await request(app)
      .post(`/accommodations/${listingIds[i]}/viewings`)
      .set('Authorization', `Bearer ${execToken}`)
      .send({ viewingType: 'live', scheduledDate: dates[i] });
    assert.equal(res.status, 201, JSON.stringify(res.body));
  }

  const fourth = await request(app)
    .post(`/accommodations/${listingIds[3]}/viewings`)
    .set('Authorization', `Bearer ${execToken}`)
    .send({ viewingType: 'live', scheduledDate: dates[3] });
  assert.equal(fourth.status, 409);
  assert.match(fourth.body.error, /reached your limit of 3 Live Viewings this month/);
});

test('Cancelling a Live Viewing frees the date back up for other Executive Customers', async () => {
  const { token: renterToken } = await makeApprovedRenter();
  const listingId = await createListing(renterToken);
  const liveDate = tomorrowIso();
  await request(app)
    .post(`/accommodations/${listingId}/viewing-availability`)
    .set('Authorization', `Bearer ${renterToken}`)
    .send({ dates: [liveDate] });

  const { token: exec1Token } = await registerCustomer('exec1@example.com');
  const { token: exec2Token } = await registerCustomer('exec2@example.com');

  const book1 = await request(app)
    .post(`/accommodations/${listingId}/viewings`)
    .set('Authorization', `Bearer ${exec1Token}`)
    .send({ viewingType: 'live', scheduledDate: liveDate });

  const cancel = await request(app)
    .post(`/customers/me/viewings/${book1.body.id}/cancel`)
    .set('Authorization', `Bearer ${exec1Token}`)
    .send();
  assert.equal(cancel.status, 200);
  assert.equal(cancel.body.status, 'cancelled');

  const book2 = await request(app)
    .post(`/accommodations/${listingId}/viewings`)
    .set('Authorization', `Bearer ${exec2Token}`)
    .send({ viewingType: 'live', scheduledDate: liveDate });
  assert.equal(book2.status, 201, JSON.stringify(book2.body));
});

test('A Customer cannot cancel another Customer\'s viewing', async () => {
  const { token: renterToken } = await makeApprovedRenter();
  const listingId = await createListing(renterToken);
  const { token: exec1Token } = await registerCustomer('exec1@example.com');
  const { token: exec2Token } = await registerCustomer('exec2@example.com');

  const book = await request(app)
    .post(`/accommodations/${listingId}/viewings`)
    .set('Authorization', `Bearer ${exec1Token}`)
    .send({ viewingType: 'video', scheduledDate: tomorrowIso() });

  const cancel = await request(app)
    .post(`/customers/me/viewings/${book.body.id}/cancel`)
    .set('Authorization', `Bearer ${exec2Token}`)
    .send();
  assert.equal(cancel.status, 403);
});

test('Admin can list viewings and assign a staff member; staff can see and complete their own assignment', async () => {
  const { token: renterToken } = await makeApprovedRenter();
  const listingId = await createListing(renterToken);
  const { token: execToken } = await registerCustomer();
  const adminToken = await makeAdmin();
  const { userId: staffUserId, token: staffToken } = await makeStaff();

  const book = await request(app)
    .post(`/accommodations/${listingId}/viewings`)
    .set('Authorization', `Bearer ${execToken}`)
    .send({ viewingType: 'video', scheduledDate: tomorrowIso() });

  const list = await request(app)
    .get('/admin/viewings?unassignedOnly=true')
    .set('Authorization', `Bearer ${adminToken}`);
  assert.equal(list.status, 200);
  assert.equal(list.body.length, 1);
  assert.equal(list.body[0].id, book.body.id);

  const assign = await request(app)
    .patch(`/admin/viewings/${book.body.id}/assign`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ staffUserId });
  assert.equal(assign.status, 200, JSON.stringify(assign.body));
  assert.equal(assign.body.assignedStaffUserId, String(staffUserId));

  const mine = await request(app).get('/staff/viewings/me').set('Authorization', `Bearer ${staffToken}`);
  assert.equal(mine.status, 200);
  assert.equal(mine.body.length, 1);
  assert.equal(mine.body[0].id, book.body.id);

  const complete = await request(app)
    .post(`/staff/viewings/${book.body.id}/complete`)
    .set('Authorization', `Bearer ${staffToken}`)
    .send();
  assert.equal(complete.status, 200);
  assert.equal(complete.body.status, 'completed');
});

test('Admin can list staff accounts (for the assign-staff dropdown)', async () => {
  const adminToken = await makeAdmin();
  const { userId: staffUserId } = await makeStaff('directory-staff@example.com');

  const list = await request(app).get('/admin/staff').set('Authorization', `Bearer ${adminToken}`);
  assert.equal(list.status, 200);
  assert.ok(list.body.some((s) => String(s.id) === String(staffUserId)));
});

test('A staff member cannot mark another staff member\'s assigned viewing complete', async () => {
  const { token: renterToken } = await makeApprovedRenter();
  const listingId = await createListing(renterToken);
  const { token: execToken } = await registerCustomer();
  const adminToken = await makeAdmin();
  const { userId: staff1Id } = await makeStaff('staff1@example.com');
  const { token: staff2Token } = await makeStaff('staff2@example.com');

  const book = await request(app)
    .post(`/accommodations/${listingId}/viewings`)
    .set('Authorization', `Bearer ${execToken}`)
    .send({ viewingType: 'video', scheduledDate: tomorrowIso() });

  await request(app)
    .patch(`/admin/viewings/${book.body.id}/assign`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ staffUserId: staff1Id });

  const complete = await request(app)
    .post(`/staff/viewings/${book.body.id}/complete`)
    .set('Authorization', `Bearer ${staff2Token}`)
    .send();
  assert.equal(complete.status, 403);
});

test('Assigning a non-staff user id is rejected (404)', async () => {
  const { token: renterToken } = await makeApprovedRenter();
  const listingId = await createListing(renterToken);
  const { token: execToken } = await registerCustomer();
  const adminToken = await makeAdmin();

  const book = await request(app)
    .post(`/accommodations/${listingId}/viewings`)
    .set('Authorization', `Bearer ${execToken}`)
    .send({ viewingType: 'video', scheduledDate: tomorrowIso() });

  const assign = await request(app)
    .patch(`/admin/viewings/${book.body.id}/assign`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ staffUserId: 999999 });
  assert.equal(assign.status, 404);
});
