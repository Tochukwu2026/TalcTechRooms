-- Starter amenities list. Renters tag their listing with a subset of these; extend freely.
INSERT INTO amenities (name) VALUES
  ('Wi-Fi'),
  ('Air Conditioning'),
  ('Generator/Backup Power'),
  ('Water Heater'),
  ('Parking'),
  ('Kitchen'),
  ('TV'),
  ('Swimming Pool'),
  ('Security'),
  ('Laundry')
ON CONFLICT (name) DO NOTHING;
