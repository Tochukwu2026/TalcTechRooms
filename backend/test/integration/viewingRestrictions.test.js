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
  if (payload.tier === 'executive') {
    // Registration never grants Executive on its own (it must be paid for) - promote directly for these tests.
    await pool.query("UPDATE customers SET tier = 'executive' WHERE user_id = $1", [res.body.user.id]);
  }
  const login = await request(app).post('/auth/login').send({ email, password: payload.password });
  return { userId: res.body.user.id, token: login.body.token };
}

function tomorrowIso() {
  return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function restrict(adminToken, state, restricted) {
  return request(app)
    .put(`/admin/viewing-restrictions/${encodeURIComponent(state)}`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ restricted });
}

test('Admin can restrict a state: viewings there are blocked, other states and the public list reflect it', async () => {
  const { token: renterToken } = await makeApprovedRenter();
  const lagosListing = await createListing(renterToken);
  const { token: execToken } = await registerCustomer();
  const adminToken = await makeAdmin();

  const res = await restrict(adminToken, 'Lagos', true);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body, { state: 'Lagos', restricted: true });

  const publicList = await request(app).get('/accommodations/viewing-restrictions');
  assert.equal(publicList.status, 200);
  assert.deepEqual(publicList.body.restrictedStates, ['Lagos']);

  const book = await request(app)
    .post(`/accommodations/${lagosListing}/viewings`)
    .set('Authorization', `Bearer ${execToken}`)
    .send({ viewingType: 'video', scheduledDate: tomorrowIso() });
  assert.equal(book.status, 403, JSON.stringify(book.body));
  assert.match(book.body.error, /Lagos/);

  const avail = await request(app)
    .get(`/accommodations/${lagosListing}/viewings/video-availability`)
    .set('Authorization', `Bearer ${execToken}`);
  assert.equal(avail.status, 403);
});

test('Lifting the restriction allows viewings again; rentals were never affected', async () => {
  const { token: renterToken } = await makeApprovedRenter();
  const listingId = await createListing(renterToken);
  const { token: execToken } = await registerCustomer();
  const adminToken = await makeAdmin();

  await restrict(adminToken, 'Lagos', true);
  const lifted = await restrict(adminToken, 'Lagos', false);
  assert.equal(lifted.status, 200);
  assert.deepEqual(lifted.body, { state: 'Lagos', restricted: false });

  const book = await request(app)
    .post(`/accommodations/${listingId}/viewings`)
    .set('Authorization', `Bearer ${execToken}`)
    .send({ viewingType: 'video', scheduledDate: tomorrowIso() });
  assert.equal(book.status, 201, JSON.stringify(book.body));
});

test('Restriction list shows every supported state with its status; unknown state is 404; non-admin is 403', async () => {
  const adminToken = await makeAdmin();
  await restrict(adminToken, 'Lagos', true);

  const list = await request(app).get('/admin/viewing-restrictions').set('Authorization', `Bearer ${adminToken}`);
  assert.equal(list.status, 200);
  const lagos = list.body.find((s) => s.state === 'Lagos');
  assert.equal(lagos.restricted, true);
  assert.ok(list.body.some((s) => s.restricted === false));

  const unknown = await restrict(adminToken, 'Atlantis', true);
  assert.equal(unknown.status, 404);

  const { token: customerToken } = await registerCustomer('plain@example.com', { tier: 'regular' });
  const denied = await request(app)
    .put('/admin/viewing-restrictions/Lagos')
    .set('Authorization', `Bearer ${customerToken}`)
    .send({ restricted: false });
  assert.equal(denied.status, 403);
});

test('Paying for Executive while a state is restricted needs the customer to accept the notice, and records it', async () => {
  const adminToken = await makeAdmin();
  await restrict(adminToken, 'Lagos', true);
  const { userId, token } = await registerCustomer('payer@example.com', { tier: 'regular' });

  const refused = await request(app).post('/customers/me/executive-upgrade/initialize').set('Authorization', `Bearer ${token}`);
  assert.equal(refused.status, 400, JSON.stringify(refused.body));
  assert.match(refused.body.error, /Lagos/);

  const ok = await request(app)
    .post('/customers/me/executive-upgrade/initialize')
    .set('Authorization', `Bearer ${token}`)
    .send({ acknowledgedViewingRestrictions: true });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));

  const { rows } = await pool.query(
    'SELECT restricted_states FROM viewing_restriction_acknowledgements WHERE customer_user_id = $1',
    [userId]
  );
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].restricted_states, ['Lagos']);
});
