# Deploying the Admin Dashboard to Google Cloud Run

This hosts the dashboard as a real website with its own URL, instead of only running on your
own laptop via `npm run dev`. Same GCP project (`talctech-rooms`) and same deploy command
pattern as `../backend/DEPLOY.md` - if you've already deployed the backend, this will feel
familiar.

Unlike the backend, this isn't a Node server - it's a static React site, served by a small
nginx container, that's it. Nothing here touches your database or needs any env vars/secrets
beyond the one already-public backend URL (baked in at `.env.production`, already committed).

## Prerequisites

- You've already run through `../backend/DEPLOY.md` at least once (gcloud installed and
  logged in, `talctech-rooms` project set as your default).
- Node.js (already installed from the backend deploy).

## Windows shells

Same notes as `../backend/DEPLOY.md`: PowerShell and `cmd.exe` quote things differently from
the examples below (written for bash/Git Bash). If a command below fails with a quoting-looking
error, that's usually why.

## Steps

### 1. Open a terminal in this folder

```bash
cd admin-dashboard
```

### 2. Confirm your gcloud project is set

```bash
gcloud config get-value project
```

Should print `talctech-rooms`. If not: `gcloud config set project talctech-rooms`.

### 3. Deploy

```bash
gcloud run deploy talctech-rooms-admin --source . --region africa-south1 --allow-unauthenticated
```

- `--source .` builds the Dockerfile in this folder via Cloud Build (same as the backend) -
  nothing needs to be built locally first.
- `--allow-unauthenticated` makes the URL reachable without a *Google* sign-in prompt - this is
  safe: the dashboard itself still requires logging in with your Admin account (email/password,
  checked against the real backend), same as it does locally. This flag only controls whether
  Google's own infrastructure gate-keeps the URL before the page even loads; it doesn't bypass
  your Admin login.
- The first run will ask to confirm enabling some APIs / creating a region - say yes, same as
  the backend deploy.

### 4. Get the URL

The deploy command prints a Service URL when it finishes (something like
`https://talctech-rooms-admin-xxxxxxxxxx.africa-south1.run.app`). Open it - you should see the
same login page you've seen locally. Sign in with your existing Admin account.

### Redeploying after future changes

Whenever the dashboard's code changes (a new page, a bug fix), redeploy with the same command:

```bash
gcloud run deploy talctech-rooms-admin --source . --region africa-south1 --allow-unauthenticated
```

If the backend's URL ever changes (e.g. redeployed to a different region), update
`.env.production` first, then redeploy this - the URL is baked in at build time, not read at
runtime.
