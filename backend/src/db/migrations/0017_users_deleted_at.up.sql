-- Self-service account deletion (Google Play requirement; also the Privacy Policy's promise).
-- "Deleted" here means ANONYMISED, not row-deleted: the person's name, email, phone, ID number,
-- address and bank details are wiped and login is closed, but the users row, bookings, payments and
-- payout rows stay (without a name attached) because TalcTech must keep financial records for
-- several years. deleted_at marks such an account; is_active is also set false at the same time.
ALTER TABLE users ADD COLUMN deleted_at TIMESTAMPTZ;
