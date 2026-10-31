-- Retire Alpha Ctrl from the accountant UI permanently.
-- Lab PDF runs use scripts/lab/* against this id; the product switcher must not.

UPDATE clients
SET archived_at = COALESCE(archived_at, now())
WHERE id = 'c1000001-0000-4000-8000-00000000a001';
