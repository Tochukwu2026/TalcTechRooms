-- Tracks the underlying storage object path (e.g. GCS object key) alongside the public URL,
-- so removing an image can also best-effort delete the real object from the bucket - see
-- src/modules/storage and src/modules/accommodations/accommodationService.js.
-- Nullable because it didn't exist before this migration (no rows to backfill in Phase 1,
-- but nullability also just reflects that a future non-GCS provider might not have one).
ALTER TABLE accommodation_images ADD COLUMN object_path TEXT;
