# TalcTech Rooms — Mobile App (Expo / React Native)

Customer-facing mobile app, built with Expo + Expo Router + TypeScript. Talks to the real
backend (see `../backend/README.md` and `../backend/DEPLOY.md`) over HTTPS.

## Status (2026-09-30)

**Auth + Customer core flow, BUILT**: login, registration (with ID verification per the spec),
search, listing detail with live availability checking, checkout (Rent/Admin Costs/VAT
breakdown), Paystack payment, and a booking confirmation screen.

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
  bundling with Metro (`npx expo export`, 1221 modules, no errors) and a full TypeScript
  check (`npx tsc --noEmit`, no errors), but the sandbox this was built in has no way to run
  an actual Expo Go session - that happens once this is pushed and the founder runs
  `npx expo start` themselves.

## Project layout

```
app/                  Expo Router screens (file-based routing)
  _layout.tsx          Root layout - wraps everything in AuthProvider
  index.tsx            Launch/redirect screen (signed in -> home, else -> login)
  (auth)/
    login.tsx
    register.tsx
  (customer)/
    home.tsx            Search screen
    listing/[id].tsx     Listing detail + availability check
    checkout/[id].tsx    Cost breakdown + Paystack payment
    confirmation.tsx     Post-booking confirmation
src/
  api/                 Typed fetch wrapper + one file per backend resource (auth,
                       accommodations, bookings) - endpoint paths/shapes match the backend's
                       actual routes exactly, not guessed
  auth/AuthContext.tsx  Signed-in user + token, persisted via expo-secure-store
  theme/colors.ts       Gold/white palette matching the supplied logo/app icon
  utils/format.ts       Naira currency formatting, accommodation-type labels
```

## Running it

```bash
npm install
npx expo start
```

Scan the QR code with the **Expo Go** app (iOS/Android) to run it on a real phone - no Xcode/
Android Studio needed for this. The app talks directly to the live backend, so no local
server setup is required either.

## Not yet built

- Renter flow (listing creation, image uploads, viewing-availability calendar) - this
  milestone covers the Customer side only, per the founder's explicit choice.
- Executive Feature Viewing booking (Live/Video Viewing) screens.
- Push notifications.
- Real app icon/splash screen assets (currently Expo's default placeholders) - the founder's
  supplied logo/icon artwork (see `spec/decisions-and-phasing.md` > Branding) needs to be
  dropped into `assets/` and wired into `app.json`.
- Proper date pickers (currently plain `YYYY-MM-DD` text fields) - fine for testing, worth
  upgrading to a real calendar picker before a store release.
