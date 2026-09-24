# TalcTech Rooms — Backend (Phase 1 scaffold)

Node.js + Express + PostgreSQL backend for the TalcTech Rooms overnight-rentals marketplace.
See `../spec/requirements-v1.md` and `../spec/decisions-and-phasing.md` for the full product
spec and confirmed business decisions this code implements.

## Status (2026-09-24)

Built and verified against a real local PostgreSQL instance (not just syntax-checked):

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
- **Accommodation listing CRUD**: approved Renters can create, list, read, update,
  deactivate/reactivate their own listings; tag amenities; mark/unmark the 30-day Live
  Viewing availability calendar. Public endpoints list price caps and amenities (for building
  location/amenity pickers) and read a single active listing with `contact_info` withheld
  until checkout exists (spec/requirements-v1.md > Renter Account & Flow). Creating or
  editing a listing's location re-runs the Price Cap check via the same DB trigger used at
  the schema level.
- **Accommodation image uploads** (added 2026-09-23): real file storage via a provider-agnostic
  interface (`src/modules/storage`), `mock` mode by default. Images go through a two-step
  direct-to-storage flow, not through this server:
  1. `POST /accommodations/:id/images/upload-url` with `{ contentType }` returns a short-lived
     signed URL (`uploadUrl`) plus the `objectPath` it was issued for.
  2. The Renter's device `PUT`s the file's bytes straight to `uploadUrl`.
  3. `POST /accommodations/:id/images` with `{ objectPath }` confirms the object exists and
     attaches it to the listing.
  `DELETE /accommodations/:id/images/:imageId` best-effort deletes the underlying object too.
  `STORAGE_MODE=gcs` switches to real Google Cloud Storage (v4 signed URLs) - **this has not
  been tested against a real GCP project/bucket**; read the caveat at the top of
  `src/modules/storage/gcsProvider.js` before pointing a real environment at it.
- Fixed a real data bug found while testing the above: the `price_caps` table's original
  `UNIQUE (state, area)` constraint didn't dedupe rows where `area IS NULL` (Postgres treats
  each `NULL` as distinct for uniqueness), so re-running the seed script silently duplicated
  the 11 flat-cap states. Migration `0009_price_caps_dedupe_null_area` de-duplicates existing
  rows and replaces the constraint with a `(state, COALESCE(area, ''))` unique index; the seed
  script's `ON CONFLICT` clause was updated to match. Verified idempotent: running
  `npm run seed` twice now yields exactly 22 rows, not 33.
- **Search + availability** (added 2026-09-24): `GET /accommodations/search` (public) - filters
  active listings by `state`, `area`, `type`, `minPrice`/`maxPrice`, and optionally a
  `checkIn`/`checkOut` date range, in which case each result gets a live
  `unitsAvailableForDates` count. `GET /accommodations/:id/availability?checkIn=&checkOut=`
  (public) is the Bookings Homepage's "Units" tab: returns `unitsAvailable`, `numberOfUnits`,
  `nights` and `nightlyRentNaira` for that stay. Availability is computed directly against the
  `bookings` table (already in the schema from Phase 1) by summing `units_booked` from any
  non-canceled booking whose date range overlaps the requested one - see
  `src/modules/booking/availabilityService.js`. **No booking-creation endpoint exists yet** -
  actually reserving units requires the checkout cost breakdown (Rent/Admin Costs/VAT/
  commission) and Paystack, both still to be built - so today this will always report full
  availability; the tests exercise the overlap math by inserting `bookings` rows directly.
- **Checkout cost module** (added 2026-09-24): `src/modules/checkout/checkoutMath.js` computes
  the Rent + Admin Costs + VAT breakdown and the 85/15 Renter/TalcTech commission split,
  reading commission %, VAT %, the flat admin fee and SMS cost from the Admin-editable
  `admin_settings` table (never hardcoded), and working in integer kobo throughout to avoid
  the floating-point rounding drift that produced the founder's own ₦0.25 arithmetic error
  caught earlier (see decisions log) - unit tests assert the exact figures from both worked
  examples there (₦20,000 rent → ₦21,613.84 total; ₦10,000 Executive subscription →
  ₦10,863.84/month).
  - `GET /accommodations/:id/checkout-preview?checkIn=&checkOut=&units=` (public) - the
    Bookings Homepage's "Total Price, nightly price breakdown", checked against live
    availability (rejects if not enough units are free for those dates).
  - `GET /customers/executive-subscription-cost` (public) - the real monthly Executive price
    at current rates, for a signup page to display.
  - **Does not create a booking** - both endpoints are read-only previews. Actually reserving
    units and charging the Customer needs Paystack, which isn't integrated yet; see decisions
    log's Build Phasing for what real booking creation still requires (payment, the two-path
    Renter payout, confirmation emails/SMS).
- **Admin management endpoints** (added 2026-09-24, backing the new Admin dashboard - see
  `../admin-dashboard/`): Price Cap and business-settings management on top of tables that
  already existed but had no admin-facing API:
  - `GET /admin/price-caps`, `POST /admin/price-caps` (create/update a location's cap -
    upserts by `(state, area)`, so re-posting an existing location just updates its cap),
    `PATCH /admin/price-caps/:id` (adjust an existing location's cap only).
  - `GET /admin/settings`, `PATCH /admin/settings/:key` - commission %, VAT %, admin fee, SMS
    cost, Executive subscription base fee. Read fresh (not cached) by the checkout module, so a
    change here takes effect on the very next checkout preview.
  - **`npm run create-admin -- --email <email> --password <password> --name "Full Name"`**
    (`src/db/createAdmin.js`) - there is deliberately no public self-registration endpoint for
    Admin accounts, so this is how the first (and any additional) Admin login gets created;
    re-running it for the same email resets that Admin's password instead of erroring.
- 40 automated tests (unit + integration, run against the real database, not mocked) - all
  passing as of this write-up. Run them yourself with `npm test`.

**Known simplifications in the Accommodation CRUD** (see comments at the relevant lines in
`src/modules/accommodations/accommodationService.js` for the full reasoning):
- In `mock` storage mode, `confirmObjectExists()` always returns `true` - there's no real
  object to check for, so confirming an image never actually verifies an upload happened; it
  trusts the client. Fine for local development; not a substitute for testing the real GCS
  provider before launch.
- Editing `numberOfUnits` resets `unitsAvailable` to match it. Fine while no booking flow
  exists yet to be holding units against active bookings - revisit once bookings exist, so an
  in-progress booking's held units aren't silently overwritten by an edit.

**Not yet built** (see `spec/decisions-and-phasing.md` > Build Phasing for the full list):
search/booking flow, the Rent/Admin-Costs/VAT/commission checkout math module,
Paystack/Termii/Prembly *live* integrations (Prembly's provider is written but untested
against real credentials - see the caveat at the top of
`src/modules/idVerification/premblyProvider.js`), the 9pm check-in-day scheduled payout job,
the Admin dashboard UI itself, and the mobile app.

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

## Image storage: mock vs. real Google Cloud Storage

`STORAGE_MODE` in `.env` controls which provider `src/modules/storage` uses:

- `mock` (default): no real bucket, no network call, no bytes actually stored anywhere. Lets
  the upload endpoints be built and tested before a real GCP project/bucket exists.
- `gcs`: real Google Cloud Storage, using v4 signed URLs so the client uploads directly to the
  bucket. Requires `GCS_BUCKET_NAME` and `GCS_PROJECT_ID` in `.env`, and Application Default
  Credentials for a service account with permission to sign URLs for that bucket (see
  `GOOGLE_APPLICATION_CREDENTIALS` in `.env.example`). Optionally set `GCS_PUBLIC_BASE_URL` if
  the bucket is fronted by a CDN/custom domain. **This has not been tested against a real
  bucket/service account** - read the caveat at the top of `src/modules/storage/gcsProvider.js`
  before switching a real environment over to it.

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
    accommodations/ listing CRUD, price-cap lookup, amenities/images/viewing-availability
  routes/           Express routers + Zod request validation
  app.js            Express app wiring (no listen() - used directly by tests)
  server.js         actual process entrypoint
test/
  unit/             pure-function tests, no DB
  integration/       supertest against the real app + a real database
```
