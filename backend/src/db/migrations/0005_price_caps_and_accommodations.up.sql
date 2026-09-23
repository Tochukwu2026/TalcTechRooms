-- Price Cap: maximum nightly rent per location. Non-Lagos states use one flat cap per state
-- (area is NULL). Lagos is capped per named area - and a Lagos accommodation MUST reference
-- one of the 11 named areas (enforced by the FK from accommodations.price_cap_id below plus
-- the trigger, which also rejects a posting priced above its cap).
CREATE TABLE price_caps (
  id BIGSERIAL PRIMARY KEY,
  state TEXT NOT NULL,
  area TEXT, -- NULL for a flat state-wide cap; a specific named area for Lagos
  cap_naira NUMERIC(10, 2) NOT NULL,
  UNIQUE (state, area)
);

CREATE TYPE accommodation_type AS ENUM (
  'room',
  'studio',
  'one_bedroom_apartment',
  'bungalow',
  'multiple_rooms_apartment',
  'duplex_house',
  'beach_house'
);

CREATE TABLE accommodations (
  id BIGSERIAL PRIMARY KEY,
  renter_user_id BIGINT NOT NULL REFERENCES renters (user_id) ON DELETE CASCADE,
  type accommodation_type NOT NULL,
  price_cap_id BIGINT NOT NULL REFERENCES price_caps (id),
  location_text TEXT NOT NULL, -- full street-level address/description of where it is
  description TEXT NOT NULL,
  contact_info TEXT NOT NULL, -- hidden from Customers until after checkout/payment
  number_of_units INTEGER NOT NULL CHECK (number_of_units > 0),
  units_available INTEGER NOT NULL CHECK (units_available >= 0),
  nightly_rent_naira NUMERIC(10, 2) NOT NULL CHECK (nightly_rent_naira > 0),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (units_available <= number_of_units)
);

CREATE INDEX idx_accommodations_renter ON accommodations (renter_user_id);
CREATE INDEX idx_accommodations_type ON accommodations (type);
CREATE INDEX idx_accommodations_price_cap ON accommodations (price_cap_id);

-- Enforce the Price Cap at listing-creation/update time. Rejects with the exact message
-- specified in spec/requirements-v1.md.
CREATE OR REPLACE FUNCTION enforce_price_cap() RETURNS TRIGGER AS $$
DECLARE
  cap NUMERIC(10, 2);
BEGIN
  SELECT cap_naira INTO cap FROM price_caps WHERE id = NEW.price_cap_id;

  IF cap IS NULL THEN
    RAISE EXCEPTION 'Invalid price cap reference for this location.';
  END IF;

  IF NEW.nightly_rent_naira > cap THEN
    RAISE EXCEPTION 'You have exceeded the Price Cap for this location.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_enforce_price_cap
  BEFORE INSERT OR UPDATE OF nightly_rent_naira, price_cap_id ON accommodations
  FOR EACH ROW EXECUTE FUNCTION enforce_price_cap();

CREATE TABLE accommodation_images (
  id BIGSERIAL PRIMARY KEY,
  accommodation_id BIGINT NOT NULL REFERENCES accommodations (id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_accommodation_images_accommodation ON accommodation_images (accommodation_id);

CREATE TABLE amenities (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE accommodation_amenities (
  accommodation_id BIGINT NOT NULL REFERENCES accommodations (id) ON DELETE CASCADE,
  amenity_id BIGINT NOT NULL REFERENCES amenities (id) ON DELETE CASCADE,
  PRIMARY KEY (accommodation_id, amenity_id)
);

-- Available Viewing Dates tab: a 30-day calendar where the Renter marks days available for
-- Live Viewing. These populate the Book Executive Feature Table for Executive Customers.
CREATE TABLE viewing_availability (
  id BIGSERIAL PRIMARY KEY,
  accommodation_id BIGINT NOT NULL REFERENCES accommodations (id) ON DELETE CASCADE,
  available_date DATE NOT NULL,
  -- Once booked by one Executive Customer for this listing, the date becomes dead for
  -- everyone else (first-come, single booking per date per listing) - see 0007.
  is_booked BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (accommodation_id, available_date)
);
