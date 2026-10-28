const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const createApp = require('../../src/app');
const { pool } = require('../../src/db/pool');
const { cleanDatabase, closeDatabase } = require('./testHelpers');

const app = createApp();
const PASSWORD = 'super-secret-1';

test.beforeEach(async () => {
  await cleanDatabase();
});
test.after(async () => {
  await cleanDatabase();
  await closeDatabase();
});

const auth = (token) => ({ Authorization: `Bearer ${token}` });

async function login(email, password = PASSWORD) {
  const res = await request(app).post('/auth/login').send({ email, password });
  return res;
}

async function makeCustomer(email = 'cust@example.com') {
  const reg = await request(app).post('/customers/register').send({
    email, phone: '08012345678', fullName: 'A Customer', password: PASSWORD, gender: 'female',
    tier: 'regular', documentType: 'passport', documentNumber: 'B1234569',
  });
  assert.equal(reg.status, 201);
  const res = await login(email);
  assert.equal(res.status, 200);
  return { token: res.body.token, id: res.body.user.id, email };
}

async function makeRenter(email = 'renter@example.com') {
  const reg = await request(app).post('/renters/register').send({
    email, phone: '08099999999', fullName: 'A Renter', password: PASSWORD,
    address: '12 Some Street, Abakaliki', documentType: 'passport', documentNumber: 'B7654329',
  });
  assert.equal(reg.status, 201);
  const res = await login(email);
  assert.equal(res.status, 200);
  await pool.query(
    `UPDATE renters SET bank_name='Bank', bank_account_number='0123456789', bank_account_name='A Renter' WHERE user_id=$1`,
    [res.body.user.id]
  );
  return { token: res.body.token, id: res.body.user.id, email };
}

async function makeListing(renterId) {
  const cap = await pool.query('SELECT id FROM price_caps WHERE area IS NULL ORDER BY id LIMIT 1');
  const { rows } = await pool.query(
    `INSERT INTO accommodations (renter_user_id, type, price_cap_id, location_text, description, contact_info,
                                 number_of_units, units_available, nightly_rent_naira)
     VALUES ($1,'room',$2,'1 Test Road','A nice room for testing','08011112222',1,1,1000) RETURNING id`,
    [renterId, cap.rows[0].id]
  );
  return rows[0].id;
}

async function makeBooking(customerId, accommodationId, { checkIn, checkOut, status = 'active', payoutStatus = 'held' }) {
  await pool.query(
    `INSERT INTO bookings (accommodation_id, customer_user_id, check_in_date, check_out_date, units_booked,
       rent_naira, admin_costs_naira, vat_naira, total_charged_naira, commission_naira,
       renter_gross_payout_naira, renter_net_payout_naira, status, payout_status, paystack_charge_reference)
     VALUES ($1,$2,$3,$4,1,1000,100,10,1110,150,850,850,$5,$6,$7)`,
    [accommodationId, customerId, checkIn, checkOut, status, payoutStatus, `ref_${accommodationId}_${customerId}_${checkIn}`]
  );
}

const day = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
};

test('a Customer can delete their account: personal data wiped, login closed, money records kept', async () => {
  const c = await makeCustomer();
  const renter = await makeRenter();
  const listing = await makeListing(renter.id);
  // A finished stay: stays on record.
  await makeBooking(c.id, listing, { checkIn: day(-10), checkOut: day(-8), status: 'completed', payoutStatus: 'released' });
  await pool.query(
    `INSERT INTO executive_subscriptions (customer_user_id, status, base_fee_naira, admin_costs_naira, vat_naira,
        total_charged_naira, paystack_authorization_code, card_brand, card_last4, card_reusable, auto_renew)
     VALUES ($1,'active',10000,105.9,757.94,10863.84,'AUTH_x','visa','4081',true,true)`,
    [c.id]
  );

  const res = await request(app).post('/auth/delete-account').set(auth(c.token)).send({ password: PASSWORD });
  assert.equal(res.status, 200);
  assert.equal(res.body.deleted, true);

  const u = (await pool.query('SELECT * FROM users WHERE id = $1', [c.id])).rows[0];
  assert.equal(u.email, `deleted-${c.id}@deleted.invalid`);
  assert.equal(u.phone, null);
  assert.equal(u.full_name, 'Deleted user');
  assert.equal(u.is_active, false);
  assert.ok(u.deleted_at);

  const idv = (await pool.query('SELECT document_number FROM id_verifications WHERE user_id = $1', [c.id])).rows;
  assert.ok(idv.length > 0 && idv.every((r) => r.document_number === 'REMOVED'));

  const gender = (await pool.query('SELECT gender FROM customers WHERE user_id = $1', [c.id])).rows[0].gender;
  assert.equal(gender, null);

  const sub = (await pool.query('SELECT * FROM executive_subscriptions WHERE customer_user_id = $1', [c.id])).rows[0];
  assert.equal(sub.status, 'canceled');
  assert.equal(sub.auto_renew, false);
  assert.equal(sub.paystack_authorization_code, null);
  assert.equal(sub.card_last4, null);

  const bookings = (await pool.query('SELECT 1 FROM bookings WHERE customer_user_id = $1', [c.id])).rows;
  assert.equal(bookings.length, 1, 'booking/payment record is kept');

  // Old login no longer works, and the old token is cut off straight away.
  assert.equal((await login(c.email)).status, 401);
  const after = await request(app).get('/customers/me').set(auth(c.token));
  assert.equal(after.status, 403);

  // The email address is free to sign up with again.
  const again = await makeCustomer(c.email);
  assert.notEqual(again.id, c.id);
});

test('deletion needs the right password', async () => {
  const c = await makeCustomer();
  const wrong = await request(app).post('/auth/delete-account').set(auth(c.token)).send({ password: 'not-it-at-all' });
  assert.equal(wrong.status, 403);
  const none = await request(app).post('/auth/delete-account').set(auth(c.token)).send({});
  assert.equal(none.status, 422);
  const noToken = await request(app).post('/auth/delete-account').send({ password: PASSWORD });
  assert.equal(noToken.status, 401);
  const stillThere = await pool.query('SELECT deleted_at FROM users WHERE id = $1', [c.id]);
  assert.equal(stillThere.rows[0].deleted_at, null);
});

test('a Customer with an upcoming stay or viewing cannot delete yet', async () => {
  const c = await makeCustomer();
  const renter = await makeRenter();
  const listing = await makeListing(renter.id);

  await makeBooking(c.id, listing, { checkIn: day(2), checkOut: day(4) });
  const blockedStay = await request(app).post('/auth/delete-account').set(auth(c.token)).send({ password: PASSWORD });
  assert.equal(blockedStay.status, 409);
  assert.match(blockedStay.body.error, /cannot delete your account yet/);

  await pool.query(`UPDATE bookings SET status = 'canceled_refundable', payout_status = 'not_applicable' WHERE customer_user_id = $1`, [c.id]);
  await pool.query(
    `INSERT INTO viewing_bookings (customer_user_id, accommodation_id, viewing_type, scheduled_date) VALUES ($1,$2,'live',$3)`,
    [c.id, listing, day(3)]
  );
  const blockedViewing = await request(app).post('/auth/delete-account').set(auth(c.token)).send({ password: PASSWORD });
  assert.equal(blockedViewing.status, 409);

  await pool.query(`UPDATE viewing_bookings SET status = 'cancelled' WHERE customer_user_id = $1`, [c.id]);
  const ok = await request(app).post('/auth/delete-account').set(auth(c.token)).send({ password: PASSWORD });
  assert.equal(ok.status, 200);
});

test('a Renter can delete: bank + address wiped, listings taken down, past bookings kept', async () => {
  const c = await makeCustomer();
  const r = await makeRenter();
  const listing = await makeListing(r.id);
  await makeBooking(c.id, listing, { checkIn: day(-9), checkOut: day(-7), status: 'completed', payoutStatus: 'released' });

  const res = await request(app).post('/auth/delete-account').set(auth(r.token)).send({ password: PASSWORD });
  assert.equal(res.status, 200);

  const renter = (await pool.query('SELECT * FROM renters WHERE user_id = $1', [r.id])).rows[0];
  assert.equal(renter.bank_account_number, null);
  assert.equal(renter.bank_name, null);
  assert.equal(renter.address, 'Removed');

  const acc = (await pool.query('SELECT is_active, contact_info FROM accommodations WHERE id = $1', [listing])).rows[0];
  assert.equal(acc.is_active, false);
  assert.equal(acc.contact_info, 'Removed');

  assert.equal((await pool.query('SELECT 1 FROM bookings WHERE accommodation_id = $1', [listing])).rows.length, 1);
  assert.equal((await login(r.email)).status, 401);
});

test('a Renter with a guest arriving or a payout still held cannot delete yet', async () => {
  const c = await makeCustomer();
  const r = await makeRenter();
  const listing = await makeListing(r.id);

  await makeBooking(c.id, listing, { checkIn: day(1), checkOut: day(3) });
  const blocked = await request(app).post('/auth/delete-account').set(auth(r.token)).send({ password: PASSWORD });
  assert.equal(blocked.status, 409);

  // Stay is over but the payout hasn't been settled yet -> still blocked.
  await pool.query(`UPDATE bookings SET check_in_date = $1, check_out_date = $2`, [day(-5), day(-3)]);
  const stillBlocked = await request(app).post('/auth/delete-account').set(auth(r.token)).send({ password: PASSWORD });
  assert.equal(stillBlocked.status, 409);

  await pool.query(`UPDATE bookings SET status = 'completed', payout_status = 'released'`);
  const ok = await request(app).post('/auth/delete-account').set(auth(r.token)).send({ password: PASSWORD });
  assert.equal(ok.status, 200);
});

test('Admin and Staff accounts cannot be deleted from the app', async () => {
  const { hashPassword } = require('../../src/modules/auth/passwords');
  const hash = await hashPassword(PASSWORD);
  await pool.query(`INSERT INTO users (role, email, password_hash, full_name) VALUES ('admin','admin@example.com',$1,'Admin')`, [hash]);
  const l = await login('admin@example.com');
  const res = await request(app).post('/auth/delete-account').set(auth(l.body.token)).send({ password: PASSWORD });
  assert.equal(res.status, 403);
});
