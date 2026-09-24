# TalcTech Rooms — Admin Dashboard

The Admin Portal: a separate web dashboard (React + Vite SPA), not part of the mobile app —
see `../spec/decisions-and-phasing.md` > Platform & Stack > Admin Portal. Talks to the backend
(`../backend`) over its existing HTTP API.

## Status (2026-09-24)

Built and smoke-tested end-to-end in a real browser (Playwright/Chromium) against the real
backend + a real local Postgres — login, table rendering, an approve action, an edit-and-save,
and logout were all exercised, not just built/typechecked.

- **Login** — Admin-only. `POST /auth/login` is shared by every account type on the backend, so
  the dashboard itself checks the returned `user.role === 'admin'` and refuses to sign in any
  other account (the backend's own `requireRole('admin')` guard on every `/admin/*` route is
  the real enforcement; this is just so a Renter/Customer doesn't get a confusing wall of 403s).
  Session (JWT + user info) is kept in `localStorage`.
- **Renter Approvals** (`/renters`) — lists pending Renter registrations with their ID
  verification status, name/email/phone/address, and document type. Approve is disabled unless
  ID verification passed (matches the backend's own rule — `admin/renters/:id/approve` 400s
  otherwise). Reject prompts for an optional reason.
- **Price Caps** (`/price-caps`) — lists every seeded location with its nightly cap, editable
  inline (`PATCH /admin/price-caps/:id`); a form below adds a new location (`POST
  /admin/price-caps`), e.g. a 12th Lagos area — re-adding an existing `(state, area)` updates
  its cap instead of erroring, matching the backend's upsert behavior.
- **Business Settings** (`/settings`) — commission %, VAT %, admin fee, SMS cost, Executive
  subscription base fee — editable inline (`PATCH /admin/settings/:key`). Changes are picked up
  immediately by the checkout module (nothing is cached server-side).
- **Not built yet** (matches what the backend itself doesn't support yet — see
  `../backend/README.md`): staff assignment for viewings, and the flagged/reported check-in-day
  booking review queue. Both depend on the viewing-booking and real-booking-creation flows,
  which aren't built. Once those exist, this dashboard is the natural place to add them.

## Requirements

- Node.js 20+
- The backend (`../backend`) running and reachable (defaults to `http://localhost:4000`)
- At least one Admin account — the backend has no public Admin self-registration, so create one
  first from `../backend`: `npm run create-admin -- --email you@example.com --password
  "a-strong-password" --name "Your Name"`

## Setup

```bash
npm install
cp .env.example .env   # edit if your backend isn't on http://localhost:4000
npm run dev
```

Opens on `http://localhost:5173`. Sign in with the Admin account you created above.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the Vite dev server with hot reload |
| `npm run build` | Production build to `dist/` |
| `npm run preview` | Serve the production build locally, to sanity-check it before deploying |

## Project layout

```
src/
  api/client.js         Thin fetch wrapper - attaches the Bearer token, throws ApiError with
                         the backend's own error message on a non-2xx response
  context/AuthContext.jsx  Session (JWT + user) in localStorage; login()/logout()
  components/
    ProtectedRoute.jsx   Redirects to /login if there's no session
    Layout.jsx           Sidebar nav + logout button, wraps every authenticated page
  pages/
    LoginPage.jsx
    RenterApprovalsPage.jsx
    PriceCapsPage.jsx
    SettingsPage.jsx
  index.css              All styling - a single stylesheet, no CSS framework
```

## Deployment

Not yet deployed anywhere (matches the backend's own GCP setup being "still to do" — see the
decisions log). `npm run build` produces a static `dist/` folder that can be hosted anywhere
static files can be served (a GCS bucket + Cloud CDN would match the backend's GCP choice);
point `VITE_API_BASE_URL` (baked in at build time) at the real backend URL before building for
that environment.
