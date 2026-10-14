-- States where TalcTech has no staff on the ground, so Executive Feature Viewings (Live/Video)
-- can't be offered. Admin-controlled; a row = restricted, deleting the row = lifted.
-- Rentals and Regular Customers are unaffected.
CREATE TABLE viewing_restricted_states (
  state TEXT PRIMARY KEY,
  restricted_by_user_id BIGINT REFERENCES users(id),
  restricted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
