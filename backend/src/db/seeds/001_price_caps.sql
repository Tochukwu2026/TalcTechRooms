-- Price Cap seed data - see spec/decisions-and-phasing.md > Business Rules > Price Cap.
-- Flat N20,000/night cap for every supported state/FCT except Lagos (area = NULL).
INSERT INTO price_caps (state, area, cap_naira) VALUES
  ('Abuja (FCT)', NULL, 20000),
  ('Cross River', NULL, 20000),
  ('Rivers', NULL, 20000),
  ('Anambra', NULL, 20000),
  ('Enugu', NULL, 20000),
  ('Delta', NULL, 20000),
  ('Akwa Ibom', NULL, 20000),
  ('Ebonyi', NULL, 20000),
  ('Imo', NULL, 20000),
  ('Abia', NULL, 20000),
  ('Bayelsa', NULL, 20000)
-- Matches the price_caps_state_area_coalesced_key index (src/db/migrations/0009_*), which
-- treats area = NULL consistently, unlike a plain UNIQUE (state, area) constraint.
ON CONFLICT (state, (COALESCE(area, ''))) DO NOTHING;

-- Lagos - by named area, not one flat state cap. A Lagos accommodation MUST reference one
-- of these 11 rows; any other Lagos area is deliberately not seeded here, which is what
-- blocks listing there (the app's picklist should only ever offer these 11 values).
INSERT INTO price_caps (state, area, cap_naira) VALUES
  ('Lagos', 'Lekki', 30000),
  ('Lagos', 'Victoria Island', 35000),
  ('Lagos', 'Ajah', 20000),
  ('Lagos', 'Sangotedo', 20000),
  ('Lagos', 'Ikeja Area', 25000),
  ('Lagos', 'Surulere/Yaba/Maryland', 25000),
  ('Lagos', 'Festac Area', 25000),
  ('Lagos', 'Ibeju-Lekki', 20000),
  ('Lagos', 'Ikoyi/Dolphin Estate/Awolowo Road Area', 25000),
  ('Lagos', 'Alaba/Mile 2 Area', 20000),
  ('Lagos', 'Apapa', 20000)
ON CONFLICT (state, (COALESCE(area, ''))) DO NOTHING;
