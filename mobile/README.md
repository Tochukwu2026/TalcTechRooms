# TalcTech Rooms — Mobile App (Expo / React Native)

One Expo app, two roles. Built with Expo + Expo Router + TypeScript, talks to the real backend
(see `../backend/README.md` and `../backend/DEPLOY.md`) over HTTPS.

## Status (2026-10-01)

**Auth + Customer core flow, BUILT** (2026-09-30): login, registration (with ID verification
per the spec), search, listing detail with live availability checking, checkout (Rent/Admin
Costs/VAT breakdown), Paystack payment, and a booking confirmation screen.

**Renter core flow, BUILT** (2026-10-01): registration (with ID verification + address),
Admin-approval status banner, listing creation, editing listing details/amenities,
activating/deactivating a listing, photo upload, and marking Live Viewing availability on a
30-day calendar.

- The sign-up screen now has a "I'm a Guest" / "I'm a Renter" toggle. Both roles log in through
  the same screen - the app routes to `(customer)` or `(renter)` based on the signed-in user's
  `role`.
- **Renter approval**: a new Renter can sign up and sign in immediately, but the backend
  requires an Admin to approve the account (via the admin dashboard's Renter Approvals page)
  before `POST /accommodations` will succeed. The Renter dashboard shows a pending/rejected
  banner and disables "+ New Listing" until `approval_status` is `approved`.
- **Photo upload**: a two-step flow (ask the backend for a signed upload URL, PUT the image
  bytes straight to storage, then confirm) per `accommodationService.requestImageUploadUrl` /
  `confirmAccommodationImage`. The backend is currently in `STORAGE_MODE=mock` (see
  `backend/DEPLOY.md`), where the signed URL is a non-loadable placeholder
  (`https://mock-storage.local/...`) - `src/api/upload.ts` detects that and skips straight to
  confirming (mock mode's own `confirmObjectExists` always returns `true` regardless - see its
  comment in `backend/src/modules/storage/mockProvider.js`). Once `STORAGE_MODE=gcs` is set,
  the same code path performs a real `PUT` of the picked photo's bytes - no code change needed.
- **Bank details**: a Renter sets the bank their payouts get sent to from a fixed picklist of
  real Nigerian bank names (mirrors `backend/src/modules/payments/nigerianBanks.js` exactly -
  keep both lists in sync if a bank is added).
- `app.json > expo.extra.apiBaseUrl` points at the deployed Cloud Run backend
  (`https://talctech-rooms-backend-964645423267.africa-south1.run.app`) - change this if the
  backend is redeployed to a different URL.
- The JWT is stored on-device via `expo-secure-store` (encrypted), not plain storage.
- **Paystack checkout**: the backend is currently in `PAYSTACK_MODE=mock` (see `DEPLOY.md`).
  In mock mode, `initializeBooking`'s `authorizationUrl` is a placeholder
  (`https://mock-paystack.local/...`) that can't actually be loaded - the checkout screen
  detects this and skips straight to verifying the booking (mock mode's own success/failure
  rule: any customer email containing `+fail@` simulates a declined charge; everything else
  succeeds). Once `PAYSTACK_MODE=paystack` is set with real credentials, the same screen opens
  a real Paystack hosted-checkout page in an in-app WebView instead - no code change needed,
  since this is detected from the URL at runtime.
- **Not yet tested against Expo Go on a real device** - this was built and verified by
  bundling with Metro (`npx expo export`, 1285 modules, no errors) and a full TypeScript
  check (`npx tsc --noEmit`, no errors), but the sandbox this was built in has no way to run
  an actual Expo Go session - that happens once this is pushed and the founder runs
  `npx expo start` themselves.

## Project layout

```
app/                  Expo Router screens (file-based routing)
  _layout.tsx          Root layout - wraps everything in AuthProvider
  index.tsx            Launch/redirect screen (signed in -> role-based home, else -> login)
  (auth)/
    login.tsx           Shared login for both roles - routes by response.user.role
    register.tsx         Guest/Renter toggle picks which extra fields + endpoint to use
  (customer)/
    home.tsx            Search screen
    listing/[id].tsx     Listing detail + availability check
    checkout/[id].tsx    Cost breakdown + Paystack payment
    confirmation.tsx     Post-booking confirmation
  (renter)/
    dashboard.tsx        Approval status, own listings, links to New Listing/Bank Details
    listing/new.tsx       Create a listing (type/state/area/amenities/price/units)
    listing/[id].tsx      Edit details/amenities, activate/deactivate, photos, viewing calendar
    bank-details.tsx     Payout bank account form
src/
  api/                 Typed fetch wrapper + one file per backend resource (auth, renters,
                       accommodations, bookings, upload) - endpoint paths/shapes match the
                       backend's actual routes exactly, not guessed
  auth/AuthContext.tsx  Signed-in user + token, persisted via expo-secure-store; separate
                       registerAndSignIn (Customer) / registerRenterAndSignIn (Renter)
  theme/colors.ts       Gold/white palette matching the supplied logo/app icon
  utils/format.ts       Naira currency formatting, accommodation-type labels
  utils/nigerianBanks.ts Fixed bank-name picklist, mirrors the backend's list
```

## Running it

```bash
npm install
npx expo start
```

Scan the QR code with the **Expo Go** app (iOS/Android) to run it on a real phone - no Xcode/
Android Studio needed for this. The app talks directly to the live backend, so no local
server setup is required either.

## Testing the Renter -> Customer flow end-to-end

1. Sign up as a Renter in the app (toggle "I'm a Renter" on the sign-up screen).
2. In the **admin dashboard**, open Renter Approvals and approve the new account.
3. Back in the app, sign out and sign back in (or just revisit the dashboard) - the pending
   banner clears and "+ New Listing" becomes enabled.
4. Create a listing, add a photo, and (optionally) mark a Live Viewing date.
5. Sign up/sign in as a Customer (or use an existing one) and search - the new listing should
   now appear, and the full search -> book -> pay -> confirm flow can be tested for real.

## Not yet built

- Executive Feature Viewing booking (Live/Video Viewing) screens on the Customer side - the
  Renter can mark availability (above), but there's no Customer-facing screen to book it yet.
- Push notifications.
- Real app icon/splash screen assets (currently Expo's default placeholders) - the founder's
  supplied logo/icon artwork (see `spec/decisions-and-phasing.md` > Branding) needs to be
  dropped into `assets/` and wired into `app.json`.
- Proper date pickers (currently plain `YYYY-MM-DD` text fields on the Customer side) - fine
  for testing, worth upgrading to a real calendar picker before a store release.
- Renter payout/booking-history screens (viewing earnings, past bookings) - only bank details
  and listing management are built so far.
