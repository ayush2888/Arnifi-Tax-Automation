-- Portal security gate: mark tenants as synthetic until security review PASS.

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS is_synthetic boolean NOT NULL DEFAULT true;

UPDATE clients SET is_synthetic = true WHERE is_synthetic IS DISTINCT FROM true;

COMMENT ON COLUMN clients.is_synthetic IS
  'When true, tenant is synthetic/demo. Non-synthetic tenants are blocked until PORTAL_SECURITY_STATUS=PASS.';
