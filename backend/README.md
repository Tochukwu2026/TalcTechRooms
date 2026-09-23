# TalcTech Rooms — Backend (Phase 1 scaffold)

Node.js + Express + PostgreSQL backend for the TalcTech Rooms overnight-rentals marketplace.
See `../spec/requirements-v1.md` and `../spec/decisions-and-phasing.md` for the full product
spec and confirmed business decisions this code implements.

## Status (2026-09-23)

Built and verified in this session, against a real local PostgreSQL instance (not just
syntax-checked):

- Full Phase 1 SQL schema as up/down migrations (`src/db/migrations`), applied and rolled
  back successfully, including the Price Cap enforcement trigger and the Lagos-area-only
  constraint (a Lagos listing can only reference one of the 11 named, seeded areas).
- Seed data for price caps, admin-editable settings, and starter amenities.
- JWT auth with role-based guards (renter / customer / admin / staff).
- Renter registration: automatic ID verification (provider-agnostic interface, mock mode by
  default) + the pending-until-admin-approval gate. Admin cannot approve a renter whose ID
  verification did not pass.
- Customer registration: instant/automatic activation once ID verification passes, no manual
  review queue.
- Admin endpoints to list/approve/reject pending renters.
- 13 automated tests (unit + integration, run with the real database, not mocked) - all
  passing as of this write-up. Run them yourself with `npm test`.

**Not yet built** (see `spec/decisions-and-phasing.md` > Build Phasing for the full list):
accommodation listing CRUD beyond the schema itself, search/booking flow, the
Rent/Admin-Costs/VAT/commission checkout math module, Paystack/Termii/Prembly *live*
integrations (Prembly's provider is written but untested against real credentials - see the
caveat at the top of `src/modules/idVerification/premblyProvider.js`), the 9pm check-in-day
scheduled payout job, the Admin dashboard UI itself, and the mobile app.

## Requirements

- Node.js 20+
- PostgreSQL 14+ (developed/tested against 16)

## Setup

```bash
npm install
cp .env.example .env   # then edit .env - at minimum set DATABASE_URL and JWT_SECRET
createdb talctech_rooms  # or: psql -c "CREATE DATABASE talctech_rooms;"
npm run migrate
npm run seed
npm run dev
```

Server listens on `PORT` from `.env` (default `4000`). Check `GET /health` once it's running.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the server with auto-restart on file changes |
| `npm start` | Start the server (production mode) |
| `npm run migrate` | Apply all pending migrations |
| `npm run migrate:down` | Roll back the single most recent migration |
| `npm run migrate:status` | List applied vs. pending migrations |
| `npm run seed` | Load seed data (price caps, admin settings, amenities) |
| `npm test` | Run the full unit + integration test suite (needs a real Postgres reachable via `DATABASE_URL`, ideally a disposable dev/test database - the integration tests `DELETE` rows from most tables between test cases) |

## ID verification: mock vs. real Prembly

`PREMBLY_MODE` in `.env` controls which provider `src/modules/idVerification` uses:

- `mock` (default): deterministic fake verification, no network calls. Any document number
  ending in the digit `0` fails; everything else passes. Lets the rest of the app be built and
  tested before real Prembly credentials exist.
- `prembly`: calls the real Prembly (IdentityPass) API. Requires `PREMBLY_APP_ID` and
  `PREMBLY_API_KEY` in `.env`. **This has not been tested against real credentials** - read the
  caveat at the top of `src/modules/idVerification/premblyProvider.js` before switching a real
  environment over to it.

## Project layout

```
src/
  config/           environment config, business-rule defaults (seeded into admin_settings)
  db/
    migrations/     numbered up/down SQL pairs - see src/db/migrate.js for the runner
    seeds/          seed SQL, run in filename order by src/db/seed.js
    pool.js         pg Pool + a withTransaction() helper
  middleware/       auth (JWT) + role guards, central error handler
  modules/
    auth/           password hashing, JWT sign/verify, login service
    idVerification/ provider-agnostic interface + mock/prembly providers
    renters/        renter registration + lookup
    customers/      customer registration
    admin/          renter approval queue
  routes/           Express routers + Zod request validation
  app.js            Express app wiring (no listen() - used directly by tests)
  server.js         actual process entrypoint
test/
  unit/             pure-function tests, no DB
  integration/       supertest against the real app + a real database
```
