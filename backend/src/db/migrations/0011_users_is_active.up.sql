-- Admin-only soft deactivation/reactivation of any account (Renter, Customer, Admin, Staff) -
-- see spec/decisions-and-phasing.md > Build Phasing for the founder's decisions: Admin-only
-- (no self-service), reversible (deactivated != deleted - all of the account's bookings,
-- listings and payout history stay intact and queryable), and the email stays reserved to the
-- account while deactivated (not freed for a new signup), so reactivating is a true undo.
ALTER TABLE users ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT true;
