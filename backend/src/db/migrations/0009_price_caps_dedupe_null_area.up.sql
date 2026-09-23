-- Bug fix: UNIQUE (state, area) does NOT dedupe rows where area IS NULL, because Postgres
-- treats every NULL as distinct from every other NULL for uniqueness purposes. Since 11 of
-- the seeded price_caps rows use area = NULL (the flat-cap states), ON CONFLICT (state, area)
-- DO NOTHING never caught a re-run of the seed script for those rows, silently duplicating
-- them (found via GET /accommodations/price-caps returning 33 rows instead of the intended 22).
--
-- Fix: replace the plain UNIQUE (state, area) constraint with a unique index over
-- (state, COALESCE(area, '')), which treats "no area" as a single, consistent value. First,
-- de-duplicate any rows this bug has already produced, keeping the lowest id of each group
-- (accommodations reference price_caps.id, so we repoint any survivors before deleting).

DO $$
BEGIN
  -- Repoint any accommodations that reference a duplicate row onto the row we're keeping.
  UPDATE accommodations a
  SET price_cap_id = keep.id
  FROM (
    SELECT DISTINCT ON (state, COALESCE(area, '')) id, state, area
    FROM price_caps
    ORDER BY state, COALESCE(area, ''), id
  ) keep
  JOIN price_caps dup
    ON dup.state = keep.state AND COALESCE(dup.area, '') = COALESCE(keep.area, '')
  WHERE a.price_cap_id = dup.id
    AND dup.id <> keep.id;
END $$;

DELETE FROM price_caps p
WHERE p.id NOT IN (
  SELECT DISTINCT ON (state, COALESCE(area, '')) id
  FROM price_caps
  ORDER BY state, COALESCE(area, ''), id
);

ALTER TABLE price_caps DROP CONSTRAINT IF EXISTS price_caps_state_area_key;

CREATE UNIQUE INDEX price_caps_state_area_coalesced_key
  ON price_caps (state, COALESCE(area, ''));
