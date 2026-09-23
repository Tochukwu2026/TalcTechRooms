DROP TABLE IF EXISTS viewing_availability;
DROP TABLE IF EXISTS accommodation_amenities;
DROP TABLE IF EXISTS amenities;
DROP TABLE IF EXISTS accommodation_images;
DROP TRIGGER IF EXISTS trg_enforce_price_cap ON accommodations;
DROP FUNCTION IF EXISTS enforce_price_cap();
DROP TABLE IF EXISTS accommodations;
DROP TYPE IF EXISTS accommodation_type;
DROP TABLE IF EXISTS price_caps;
