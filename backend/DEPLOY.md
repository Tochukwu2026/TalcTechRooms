# Deploying the TalcTech Rooms backend to Google Cloud Run

This is a **runbook for you to run yourself** in your own terminal, against your own GCP account
- I can't run `gcloud` against your account from here (no access to your GCP credentials/billing,
same reason I never touch your Paystack/Termii dashboard login). Everything below is copy/paste.

You'll need:
- A Google Cloud project with billing enabled (Cloud Run + Cloud SQL both have an always-free
  tier, but the project itself needs a billing account attached to use them at all).
- The `gcloud` CLI installed and logged in (`gcloud auth login`), or use Cloud Shell in the GCP
  Console, which has it preinstalled.
- **Node.js (LTS) installed on your own machine**, if you're running the migrate/seed/create-admin
  commands in step 3 from there rather than Cloud Shell - `npm` needs it. After installing, open a
  **brand new** terminal window (PATH changes don't apply to windows already open).

Replace `YOUR_PROJECT_ID` and `YOUR_REGION` throughout (e.g. `africa-south1` for Nigeria-based
users - closest region with both Cloud Run and Cloud SQL support as of this write-up; GCP doesn't
have a Lagos/West Africa region itself).

**A note on Windows shells**: commands below are written in bash syntax (works as-is in Git Bash
or Cloud Shell). In PowerShell or `cmd.exe`:
- Single-quoted flag values (`--format='...'`) need double quotes instead (`--format="..."`), or
  no quotes at all in `cmd.exe`.
- `VAR=value command` (setting an env var inline before a command) doesn't work - use `set VAR=value`
  then the command on its own line (`cmd.exe`), or `$env:VAR="value"` (PowerShell).
- `curl` ships built into Windows 10/11; `Invoke-WebRequest` is the PowerShell-only equivalent (not
  available in `cmd.exe`).

## 1. One-time project setup

```bash
gcloud config set project YOUR_PROJECT_ID

gcloud services enable \
  run.googleapis.com \
  sqladmin.googleapis.com \
  sql-component.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  cloudscheduler.googleapis.com
```

## 2. Create the Cloud SQL Postgres instance

This replaces the throwaway local Postgres used for development/testing.

```bash
gcloud sql instances create talctech-rooms-db \
  --database-version=POSTGRES_16 \
  --tier=db-f1-micro \
  --region=YOUR_REGION \
  --storage-size=10GB \
  --edition=ENTERPRISE

gcloud sql databases create talctech_rooms --instance=talctech-rooms-db

# Pick a real password here and save it somewhere safe (a password manager) - you'll need it
# again below for DATABASE_URL.
gcloud sql users create talctech_app \
  --instance=talctech-rooms-db \
  --password=CHOOSE_A_STRONG_PASSWORD

# You'll need this for both migrations (step 3) and the deploy command (step 5).
gcloud sql instances describe talctech-rooms-db --format='value(connectionName)'
# -> prints something like YOUR_PROJECT_ID:YOUR_REGION:talctech-rooms-db
```

**`--edition=ENTERPRISE` note (found 2026-09-30, running this for real):** for PostgreSQL 16+,
several regions (confirmed for `africa-south1`, likely others) default new Cloud SQL instances to
"Enterprise Plus" edition, which does NOT support the shared-core `db-f1-micro`/`db-g1-small`
tiers this guide uses - instance creation fails with `Invalid Tier (db-f1-micro) for
(ENTERPRISE_PLUS) Edition` without this flag. `--edition=ENTERPRISE` forces the small/cheap
shared-core tier regardless of region.

## 3. Run migrations + seed data against Cloud SQL

The simplest way to run one-off commands (migrate/seed/create-admin) against Cloud SQL from your
own machine is the Cloud SQL Auth Proxy, which opens a secure local tunnel to it.

```bash
# Download the proxy (one-time). Check https://cloud.google.com/sql/docs/postgres/sql-proxy for
# the current version and the exact download for your OS (Linux/Mac/Windows all differ).
curl -o cloud-sql-proxy https://storage.googleapis.com/cloud-sql-connectors/cloud-sql-proxy/v2.26.0/cloud-sql-proxy.linux.amd64
chmod +x cloud-sql-proxy

# The proxy authenticates via "Application Default Credentials", which is separate from
# `gcloud auth login` - run this once if the proxy errors with "could not find default
# credentials":
gcloud auth application-default login

# In one terminal, leave this running:
./cloud-sql-proxy YOUR_PROJECT_ID:YOUR_REGION:talctech-rooms-db --port 5433

# In another terminal, from the backend/ directory:
cd backend
npm install
DATABASE_URL="postgres://talctech_app:CHOOSE_A_STRONG_PASSWORD@localhost:5433/talctech_rooms" npm run migrate
DATABASE_URL="postgres://talctech_app:CHOOSE_A_STRONG_PASSWORD@localhost:5433/talctech_rooms" npm run seed
DATABASE_URL="postgres://talctech_app:CHOOSE_A_STRONG_PASSWORD@localhost:5433/talctech_rooms" npm run create-admin -- --email YOUR_ADMIN_EMAIL --password CHOOSE_A_STRONG_PASSWORD --name "Your Name" --phone "08000000000"
```

(On Windows `cmd.exe`, the inline `DATABASE_URL="..." npm run ...` syntax above doesn't work - use
`set DATABASE_URL=postgres://talctech_app:CHOOSE_A_STRONG_PASSWORD@localhost:5433/talctech_rooms`
on its own line first, then run each `npm run ...` command separately, same window.)

`create-admin` takes its email/password/name/phone as command-line flags (not an interactive
prompt) - note the `--` after `create-admin`, which tells `npm` to pass the flags through to the
script rather than trying to interpret them itself.

You can stop the Cloud SQL Auth Proxy (Ctrl+C in its terminal, or just close the window) once this
step is done - it's only needed for these one-off commands, not for the running app itself (Cloud
Run connects to Cloud SQL a different way - see step 4).

## 4. Build and deploy to Cloud Run

`gcloud run deploy --source .` builds the `Dockerfile` in `backend/` via Cloud Build and deploys
it in one command - you don't need to manually push to a container registry first.

**Env vars go in a file, not a `--set-env-vars` flag.** `gcloud`'s documented way to pass several
env vars at once without comma-ambiguity is a `^##^`-delimited string
(`--set-env-vars="^##^KEY1=val1##KEY2=val2"` - see `gcloud topic escaping`), but `^` is itself a
shell escape character in Windows `cmd.exe`, making that combination untested/risky there. Use
`--env-vars-file` instead, which sidesteps the issue entirely on every shell:

Create `backend/env-vars.yaml` (and add it to `.gitignore` - it holds real secrets and must never
be committed):

```yaml
NODE_ENV: "production"
INSTANCE_UNIX_SOCKET: "/cloudsql/YOUR_PROJECT_ID:YOUR_REGION:talctech-rooms-db"
DB_USER: "talctech_app"
DB_PASSWORD: "CHOOSE_A_STRONG_PASSWORD"
DB_NAME: "talctech_rooms"
JWT_SECRET: "CHOOSE_A_LONG_RANDOM_STRING"
SCHEDULER_SECRET: "CHOOSE_ANOTHER_LONG_RANDOM_STRING"
STORAGE_MODE: "mock"
PREMBLY_MODE: "mock"
PAYSTACK_MODE: "mock"
TERMII_MODE: "mock"
```

```bash
echo env-vars.yaml >> .gitignore

cd backend

gcloud run deploy talctech-rooms-backend \
  --source . \
  --region=YOUR_REGION \
  --allow-unauthenticated \
  --add-cloudsql-instances=YOUR_PROJECT_ID:YOUR_REGION:talctech-rooms-db \
  --env-vars-file=env-vars.yaml
```

**Note on `--allow-unauthenticated`**: this makes the API publicly reachable, which it needs to be
- your future mobile app and Paystack's webhook both call it directly. Cloud Run's own HTTPS/TLS
handles transport security; the app's own auth (JWT, role guards, the scheduler shared secret,
the webhook signature check) is what actually gates access to anything sensitive.

**Everything is deliberately left in `mock` mode above** - this deploys a real, reachable backend
so the mobile app has something to talk to, without requiring your real Paystack/Prembly/Termii/
GCS credentials yet. Swap any of the `_MODE` values and add the matching credential env vars
(`PAYSTACK_SECRET_KEY`, etc. - see `.env.example` for the full list) once you're ready to test
against a real provider - each is independent, so you can flip them on one at a time. After
editing `env-vars.yaml`, redeploy (see below) to pick up the change.

The command prints a **Service URL** (`https://SERVICE-NAME-xxxxx.YOUR_REGION.run.app`) when it
finishes - that's the real, always-on URL the mobile app will use as its API base URL. Confirm
it's alive:

```bash
curl https://YOUR-SERVICE-URL/health
# -> {"status":"ok"}
```

## 5. Wire up the scheduled payout evaluation job (optional, can wait)

Once the service is live, see `backend/README.md` > "Real scheduler wiring" for the
`gcloud scheduler jobs create http ...` command - just substitute your real Service URL and the
same `SCHEDULER_SECRET` value you set above.

## Redeploying after future code changes

Once this initial setup is done, shipping a code change is just:

```bash
cd backend
gcloud run deploy talctech-rooms-backend --source . --region=YOUR_REGION
```

(Cloud Run remembers the env vars and Cloud SQL connection from the first deploy - you only need
to repeat `--env-vars-file`/`--add-cloudsql-instances` if you're changing one of them.)

## Cost note

`db-f1-micro` (Cloud SQL) and Cloud Run's free tier are both intended for light/dev workloads -
fine for building and testing the mobile app against, but worth revisiting instance size before
real users are on it. Neither is completely free at 24/7 uptime; check the GCP pricing calculator
if you want a cost estimate before running the above.
