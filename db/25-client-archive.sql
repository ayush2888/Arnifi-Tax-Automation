-- Soft-archive clients so lab shells (e.g. Alpha Ctrl) can be removed from the UI
-- without hard-deleting posted history.

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

CREATE INDEX IF NOT EXISTS clients_archived_idx
  ON clients (firm_id)
  WHERE archived_at IS NULL;

-- Hide the old Alpha Ctrl lab shell from company switcher / bank uploads.
UPDATE clients
SET archived_at = COALESCE(archived_at, now())
WHERE id = 'c1000001-0000-4000-8000-00000000a001'
  AND archived_at IS NULL;
