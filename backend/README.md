# TalcTech Rooms — Backend (Phase 1 scaffold)

Node.js + Express + PostgreSQL backend for the TalcTech Rooms overnight-rentals marketplace.
See `../spec/requirements-v1.md` and `../spec/decisions-and-phasing.md` for the full product
spec and confirmed business decisions this code implements.

## Status (2026-09-25)

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
- **Real booking creation + Paystack charge** (added 2026-09-25): the piece the checkout module
  above deliberately stopped short of. Two-step flow, matching how Paystack's own
  Initialize/Verify Transaction API works:
  1. `POST /accommodations/:id/bookings/initialize` (Customer, ID verification must have
     passed) - re-validates availability, computes the cost breakdown at the CURRENT
     `admin_settings` rates via the same `resolveBookingQuote` the checkout preview uses, then
     starts a Paystack charge for the total. Returns `{ reference, authorizationUrl, ... }`.
     **No `bookings` row is created yet** - the full breakdown is locked into the charge's
     `metadata` instead, since a booking only exists after payment (per the decisions log) and
     the schema has no "pending" status to represent an unpaid attempt.
  2. `POST /bookings/verify/:reference` (Customer) - the app's own fallback for confirming a
     payment (there's no hosted checkout return-page built yet to receive Paystack's redirect).
     Checks what Paystack says happened to the charge and, only if it succeeded, creates the
     `bookings` row from the locked-in metadata - re-checking availability one more time first,
     since time has passed since step 1. `POST /webhooks/paystack` is the real-world primary
     trigger (Paystack calls this directly) and does the exact same finalize - both paths are
     idempotent, so whichever gets there first "wins" and the other is a no-op.
  - New provider-agnostic payments interface (`src/modules/payments`), `mock` mode by default -
    see "Payments: mock vs. real Paystack" below for how the mock decides success/failure (there's
    no real card-entry page yet to key it off).
  - `GET /bookings/:id` (Customer, own bookings only) for basic retrieval.
  - **Deliberately NOT built yet, by founder's own choice**: an automatic refund when a charge
    succeeds but the units turned out to be taken in the meantime (`/bookings/verify` returns a
    distinct `availability_conflict` status for this so the Customer can be told to contact
    support, rather than silently creating an invalid booking or losing their money without
    explanation). The two-path Renter payout itself (below) is now built.
  - Test coverage: 12 new tests (3 unit tests for the mock Paystack provider's deterministic
    success/failure behavior, 9 integration tests for the full initialize → verify → booking-row
    flow, including idempotency, a declined charge, an unverified Customer being blocked, a
    second Customer losing a race for the last unit, and ownership checks on `GET /bookings/:id`).
- **Two-path Renter payout, BUILT AND TESTED (2026-09-25)** - the piece the booking-creation
  milestone above deliberately stopped short of. Per the founder's explicit scope choice
  ("Everything except real scheduling"): everything is built and tested except the 9pm trigger
  itself, which is a standalone script, not wired to real cron infrastructure (none exists yet).
  - **Path A - held until check-in day**: `POST /bookings/:id/confirm-check-in` (Customer) fires
    the payout immediately (Renter's 85% net of nothing extra yet - no Paystack transfer-fee
    logic exists, same as before - and TalcTech's 15% is simply recognized, no ledger entry
    needed). `POST /bookings/:id/report-problem` (Customer, optional `{ notes }`) instead holds
    the payout and opens an Admin review case (`reason='fraud_report'`). If a Customer does
    neither, `src/jobs/evaluateCheckInDayPayouts.js` - a standalone script meant to be invoked
    once daily at/after 9pm WAT by an external scheduler (`npm run evaluate-payouts`; see below) -
    flags every still-`active`/`held` booking whose check-in date has arrived
    (`reason='no_show_no_response'`). This job only ever flags - it never releases a payout,
    since by construction a booking it reaches is one the Customer didn't act on.
  - **Path B - instant on a confirmed no-refund cancellation**: `POST /bookings/:id/cancel`
    (Customer) checks the booking's own check-in date against the existing 7-day refund cutoff:
    `>=7` days out creates a `refunds` row (Rent portion only, `reason='customer_cancellation'`,
    per the confirmed Refund scope rule) and marks `payout_status='not_applicable'` - no payout,
    ever, for a refunded booking; `<7` days out (or on/after check-in) instead pays the Renter
    and TalcTech out immediately, independent of check-in day.
  - **Admin review queue**: `GET /admin/review-cases` (defaults to open cases; `?status=resolved`
    for closed ones) and `PATCH /admin/review-cases/:id/resolve` with
    `{ resolution: 'release_payout' | 'refund_customer', notes? }` - the former pays the Renter
    (same transfer path as Path A/B), the latter refunds the Customer's Rent portion
    (`reason='fraud_confirmed'`, since an admin-resolved review case is never a customer-initiated
    cancellation) and marks the Renter as never paid for that booking.
  - **Renter bank details**: `PATCH /renters/me/bank-details` with
    `{ bankName, bankAccountNumber, bankAccountName }` - no verification of the details
    themselves (e.g. no "resolve account number" call); wrong details simply make the payout
    transfer fail, which lands the booking in `admin_review` rather than silently losing track of
    the money - the same failure path a bad account number would hit through Paystack anyway.
  - **New provider-agnostic function**: `payments.initiateTransfer(...)` (mock by default - a
    bank account number ending in `0` deterministically simulates a failed transfer, mirroring
    the ID-verification mock's "document number ending in 0" convention). The real
    `paystackProvider.js` implementation is written from Paystack's Transfer API docs but has an
    extra, more serious caveat than the charge side: it currently passes the Renter's free-text
    `bank_name` through as Paystack's required numeric `bank_code`, which **will not work
    against the real API as written** - resolving this (a `GET /bank` lookup, storing the real
    code) is necessary before ever switching `PAYSTACK_MODE` away from `mock`. See the caveat
    comment at the top of that function for the full list.
  - **A real bug found and fixed while building this**: node-postgres was parsing `DATE` columns
    (e.g. `bookings.check_in_date`) into JS `Date` objects at local midnight in the server
    process's own timezone, which could silently shift the calendar date by a day depending on
    that process's `TZ` setting - a correctness risk for exactly the kind of "is today the
    check-in day" comparison this feature needed. Fixed globally in `src/db/pool.js` by telling
    `pg` to keep `DATE` columns as plain `'YYYY-MM-DD'` strings, matching how the rest of the app
    already treats dates.
  - No new migration was needed - the Phase 1 schema already had every column/enum value this
    required (`bookings.payout_status`, `admin_review_cases`, `refunds.reason`,
    `renters.bank_*`).
  - Test coverage: 2 new unit tests (the mock transfer provider's deterministic success/failure),
    15 new integration tests (Path A confirm/report/admin-resolve both ways, the evaluation job
    flagging an unconfirmed booking and leaving a confirmed one alone, Path B both the no-refund
    and the >=7-day-refundable branches, a mock transfer failure landing in `admin_review` rather
    than being silently lost, ownership/role checks, double-confirm rejection, and the bank-
    details endpoint).
- **Live/Video Viewing booking system, BUILT AND TESTED (2026-09-25)** - the Executive Customer
  "Book Executive Feature Table" from spec/requirements-v1.md, backend only for this pass (the
  founder's explicit choice - Admin-dashboard UI for staff assignment is a follow-up). No new
  migration needed - `viewing_bookings` and `viewing_availability` already existed from Phase 1.
  - **Video Viewing**: `GET /accommodations/:id/viewings/video-availability` (Executive Customer
    only) returns the next 30 days, no restriction on which date - any date in the window can be
    booked. `POST /accommodations/:id/viewings` with `{ viewingType: 'video', scheduledDate }`
    enforces the 1-per-listing weekly limit, measured as a **rolling 7 days from the Customer's
    most recent (non-cancelled) booking for that listing** - the founder's explicit choice over a
    calendar-week definition - returning the spec's exact message ("You have exceeded your weekly
    limit for this location.") on a repeat within the window. No cap across different listings.
  - **Live Viewing**: `GET /accommodations/:id/viewings/live-availability` returns only the dates
    the Renter marked via the existing viewing-availability endpoint that aren't already booked -
    everything else is simply absent from the list ("dead" per spec). Booking one of these dates
    enforces both monthly caps (1 per listing, 3 total across all listings per calendar month)
    and is exclusive: a booked date is removed from every other Executive Customer's availability
    list, backed by both an application check and the existing partial unique index on
    `viewing_bookings` so a race between two simultaneous requests can't double-book it.
  - **Cancellation**: `POST /customers/me/viewings/:id/cancel` (own viewings only) - for a Live
    Viewing, also frees the date back up so it can be rebooked; not explicit in the spec, but
    leaving a cancelled booking's date permanently dead seemed clearly unintended.
  - **Admin/Staff assignment**: `GET /admin/review-cases`-style queue at `GET /admin/viewings`
    (`?unassignedOnly=true` for the common case) and `PATCH /admin/viewings/:id/assign` with
    `{ staffUserId }`. New `npm run create-staff` (mirrors `create-admin`) provisions Staff
    accounts - the `staff` role already existed in the schema but had no way to create one.
    `GET /staff/viewings/me` and `POST /staff/viewings/:id/complete` (own assignments only) are
    Staff's own limited view, on a new `staffRoutes.js`/`/staff` mount.
  - **Deliberately NOT sent**: the spec's "confirmation emailed and sent via SMS" on viewing
    bookings - Termii isn't wired up to anything anywhere in this codebase yet (only the
    `notifications_log` table exists), so this stays consistent with real booking creation, which
    doesn't send them either.
  - **Assumption made, not asked about**: viewing bookings do NOT require the Customer's ID
    verification to have passed, unlike real (paid) booking creation - a viewing isn't a monetary
    transaction and the spec doesn't call for this gate. Flagging in case the founder wants it
    added for consistency.
  - Test coverage: 14 new integration tests (Video Viewing booking + the weekly-limit rejection
    and its rolling-window reset + no cross-listing cap, a Regular Customer's 403, Live Viewing
    booking + availability removal + the double-booking 409 + an unmarked-date 404 + both monthly
    caps + cancellation freeing the date back up + cross-customer cancel rejection, and the full
    Admin-assign/Staff-complete path including a wrong-staff-member rejection and a non-staff
    assignment 404).
- **Admin dashboard UI for both backend-only queues, BUILT (2026-09-25)** - the founder's next
  pick after the Live/Video Viewing backend above: two new pages in `admin-dashboard/`, following
  the exact conventions of the existing Renter Approvals / Price Caps pages (same `apiFetch`/
  `useAuth` pattern, `.badge-<status>` styling, row-scoped action buttons).
  - **Payout Review Cases** (`/review-cases`): lists open/resolved cases from
    `GET /admin/review-cases?status=`, shows the booking id, check-in date, reason, notes, payout
    amount and payout status, and resolves a case via `PATCH /admin/review-cases/:id/resolve`
    with a `window.confirm` + optional notes prompt for either `release_payout` or
    `refund_customer`.
  - **Viewing Assignments** (`/viewings`): lists viewings from `GET /admin/viewings`
    (`unassignedOnly` checkbox, defaults on) and assigns a staff member via a dropdown + Assign
    button, calling `PATCH /admin/viewings/:id/assign`.
  - **New backend endpoint added to support the dropdown**: `GET /admin/staff` (Admin-only) lists
    all `role = 'staff'` users (`id`, `email`, `full_name`) - there was no way to enumerate staff
    accounts before this; the alternative (a manual staff-user-ID text field) would have made the
    Admin look up ids by hand, which the dropdown avoids. 1 new integration test covers it.
  - Both new pages and the new nav links (`Layout.jsx`) are Admin-only, same as the rest of the
    dashboard - no separate Staff-facing UI was built (Staff still only has the API,
    `GET /staff/viewings/me` / `POST /staff/viewings/:id/complete`, per the original backend-only
    scope for this feature).
- **Automatic refund on an availability conflict, BUILT (2026-09-26)** - the piece
  `bookingService.finalizeBooking` deliberately stopped short of when booking creation was first
  built (see the "Deliberate scope cut" note above), now built. Fixes the race where two
  Customers both pass the availability check at `initialize` time but only one unit remains, so
  whichever of them finalizes second has already been charged for a unit that's now gone.
  - `finalizeBooking` now calls a new `payments.initiateRefund({ amountKobo, reference, reason })`
    against the ORIGINAL charge's own reference (Paystack's real Refund API needs only that - no
    bank/recipient details, since Paystack returns the money to the original payment method
    itself, unlike a Renter payout Transfer). `paystackProvider.js`'s implementation is written
    from Paystack's docs but **not yet tested against real credentials** (same caveat pattern as
    the other providers) and has its own caveat about Paystack's refund possibly being
    asynchronous (`pending` vs `processed`) - see the comment at the top of that function.
  - **Refund amount - the founder's explicit choice (2026-09-26)**: the **full** amount charged
    (Rent + Admin Costs + VAT), not the Rent-only scope that applies to an actual cancellation or
    fraud case (see Refund scope in `spec/decisions-and-phasing.md`) - since no booking is ever
    created here and nothing was delivered at all, there's no basis for TalcTech to keep any part
    of the charge.
  - **Schema change**: migration `0010_refund_availability_conflict` makes `refunds.booking_id`
    nullable and adds `refunds.paystack_charge_reference` - an availability-conflict refund has no
    `bookings` row to attach to (a booking only ever represents a real, successfully reserved
    stay), so it's recorded with `booking_id = NULL` and the original charge's reference instead.
    Also adds `'availability_conflict'` to the `refund_reason` enum, alongside the existing
    `'customer_cancellation'`/`'fraud_confirmed'`.
  - `finalizeBooking`'s conflict return value is now `'availability_conflict_refunded'` (refund
    succeeded - the normal case) or `'availability_conflict_refund_failed'` (the refund call
    itself failed, e.g. a real Paystack outage - rare enough, and with no booking to attach an
    Admin review case to, that surfacing it in the response for the Customer to contact support is
    the right fallback rather than a dedicated review queue). Both are still HTTP 409 from
    `POST /bookings/verify/:reference`, now with a message telling the Customer what actually
    happened instead of asking them to contact support for a refund that isn't automatic.
  - **Real test-authoring bug found and fixed while adding coverage for this**: an existing Live
    Viewing monthly-cap test computed its 4 test dates as `today + {2,3,4,5} days`, which
    intermittently rolled into the following calendar month whenever "today" was late enough in
    the month (it broke on 2026-09-26, since Sep 26 + 5 days = Oct 1) - the monthly cap is
    deliberately calendar-month-scoped, so a date in the next month was never going to be capped
    by the current month's count. Fixed with a `sameMonthFutureDates()` helper anchored to the
    1st of next month instead of an offset from "today".
  - Test coverage: 2 new unit tests (the mock refund provider's deterministic success/failure,
    keyed off whether a charge actually succeeded via `initializeCharge` - there's no user-
    supplied input to fail on the way there is for ID documents/bank accounts) + 1 new integration
    test (two Customers racing for the last unit - the first finalizes and gets a real booking,
    the second gets `availability_conflict_refunded` and a `refunds` row for the full amount with
    `booking_id = NULL`).
- 85 automated backend tests (unit + integration, run against the real database, not mocked) -
  all passing as of this write-up. Run them yourself with `npm test`.

**Known simplifications in the Accommodation CRUD** (see comments at the relevant lines in
`src/modules/accommodations/accommodationService.js` for the full reasoning):
- In `mock` storage mode, `confirmObjectExists()` always returns `true` - there's no real
  object to check for, so confirming an image never actually verifies an upload happened; it
  trusts the client. Fine for local development; not a substitute for testing the real GCS
  provider before launch.
- Editing `numberOfUnits` resets `unitsAvailable` to match it. Fine while no booking flow
  exists yet to be holding units against active bookings - revisit once bookings exist, so an
  in-progress booking's held units aren't silently overwritten by an edit.

**Not yet built** (see `spec/decisions-and-phasing.md` > Build Phasing for the full list): real
cron/scheduler wiring for the 9pm-WAT payout evaluation script (see "evaluate-payouts" below),
Termii/Prembly/Paystack *live* integrations (all providers are written but untested against real
credentials - see the caveats at the top of `src/modules/idVerification/premblyProvider.js`,
`src/modules/storage/gcsProvider.js`, and `src/modules/payments/paystackProvider.js` -
Paystack's Transfer (payout) side has an additional unresolved `bank_code` caveat, see below),
and the mobile app.

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
| `npm run create-staff -- --email <email> --password <password> --name "Full Name"` | Create (or reset the password of) a Staff account - no public self-registration endpoint, same as `create-admin` |
| `npm run evaluate-payouts` | Runs the 9pm-WAT check-in-day payout evaluation once (see "Renter Payout" below). CLI only, no HTTP endpoint - meant to be invoked once daily by an external scheduler (cron, GCP Cloud Scheduler, etc.) once one is set up; not wired to any scheduler yet |
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

## Payments: mock vs. real Paystack

`PAYSTACK_MODE` in `.env` controls which provider `src/modules/payments` uses:

- `mock` (default): no real API calls, no real card entry (there's no hosted checkout page or
  mobile app built yet to provide one). Deterministic instead: any Customer email containing
  `+fail` right before the `@` (e.g. `jane+fail@example.com`) simulates a declined charge;
  everything else simulates success. This convention goes away once a real checkout
  page/SDK is integrated - at that point success/failure genuinely comes from Paystack.
- `paystack`: calls the real Paystack REST API (Initialize/Verify Transaction). Requires
  `PAYSTACK_SECRET_KEY` in `.env` - get real **test** keys from your own Paystack dashboard
  (Settings > API Keys & Webhooks), never your Paystack account login/password. **This has not
  been tested against real credentials** - read the caveat at the top of
  `src/modules/payments/paystackProvider.js` before switching a real environment over to it,
  including the webhook signature verification, which is written per Paystack's documented
  scheme but never exercised against a real webhook payload.
- The Transfer (payout) side has its own, more serious caveat on top of the above: it passes the
  Renter's free-text `bank_name` through as Paystack's required numeric `bank_code`, which will
  not work against the real API until either a `GET /bank` lookup table is added or the real
  bank code is captured at bank-details-submission time instead of/alongside the bank name - see
  the comment on `initiateTransfer` in `paystackProvider.js`.

## Renter Payout: the two-path hold/release system

See `spec/decisions-and-phasing.md` > Business Rules > Renter Payout for the full rationale (why
there are two paths, why Path A holds until check-in day instead of using Paystack's instant
split-payment feature). In short:

- **Path A** (an active booking heading into check-in day): `POST /bookings/:id/confirm-check-in`
  releases the payout right away; `POST /bookings/:id/report-problem` holds it and opens an
  Admin review case instead; doing neither by check-in day gets the booking flagged for Admin
  review by `npm run evaluate-payouts` (see above) rather than auto-paid.
- **Path B** (a cancellation): `POST /bookings/:id/cancel` refunds the Rent portion if it's still
  >=7 days before check-in, or pays the Renter/TalcTech out instantly otherwise - independent of
  check-in day entirely.
- **Admin resolution**: `GET /admin/review-cases` / `PATCH /admin/review-cases/:id/resolve`
  (`{ resolution: 'release_payout' | 'refund_customer' }`) is where a held/flagged booking's
  money actually moves, once an Admin has looked into it.
- A Renter supplies payout bank details via `PATCH /renters/me/bank-details`.

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
    storage/        provider-agnostic interface + mock/gcs providers (accommodation images)
    payments/       provider-agnostic interface + mock/paystack providers (charges, transfers, refunds)
    renters/        renter registration + lookup + bank-details update
    customers/      customer registration
    admin/          renter approval queue, staff directory, price-cap + settings management
    accommodations/ listing CRUD, price-cap lookup, amenities/images/viewing-availability
    checkout/       Rent/Admin-Costs/VAT/commission math + admin_settings lookup
    booking/        availability math + real booking creation (Paystack charge -> bookings row)
    payout/         two-path Renter payout (confirm-check-in/report-problem/cancel/admin resolve)
    viewings/       Live/Video Viewing booking + quota rules + Admin/Staff assignment
  jobs/             standalone scripts, not HTTP routes (evaluateCheckInDayPayouts.js - the 9pm
                    WAT check-in-day payout evaluation, run via `npm run evaluate-payouts`)
  routes/           Express routers + Zod request validation (includes bookingRoutes.js,
                    webhookRoutes.js for Paystack's own webhook, and staffRoutes.js)
  app.js            Express app wiring (no listen() - used directly by tests)
  server.js         actual process entrypoint
test/
  unit/             pure-function tests, no DB
  integration/       supertest against the real app + a real database
```
