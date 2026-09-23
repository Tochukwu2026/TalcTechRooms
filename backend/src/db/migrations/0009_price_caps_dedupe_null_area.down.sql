DROP INDEX IF EXISTS price_caps_state_area_coalesced_key;
ALTER TABLE price_caps ADD CONSTRAINT price_caps_state_area_key UNIQUE (state, area);
