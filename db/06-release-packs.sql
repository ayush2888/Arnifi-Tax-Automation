-- Stage B: VAT201 release packs, dual-control approvals, download audit.
-- Applied after 04-ledger.sql / 05-ledger-seed.sql on fresh Compose volumes.

CREATE TABLE release_packs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id),
  period_id uuid NOT NULL REFERENCES accounting_periods(id),
  kind text NOT NULL CHECK (kind IN ('VAT201', 'STATEMENTS', 'CT')),
  version int NOT NULL CHECK (version >= 1),
  status text NOT NULL CHECK (status IN (
    'DRAFT', 'PENDING_APPROVAL', 'RELEASED', 'STALE', 'VOID'
  )),
  content_hash text NOT NULL,
  payload_json jsonb NOT NULL,
  prepared_by uuid NOT NULL REFERENCES users(id),
  prepared_at timestamptz NOT NULL DEFAULT now(),
  approved_by uuid REFERENCES users(id),
  approved_at timestamptz,
  released_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, period_id, kind, version),
  CHECK (approved_by IS NULL OR approved_by <> prepared_by)
);

CREATE TABLE pack_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pack_id uuid NOT NULL REFERENCES release_packs(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES clients(id),
  actor_id uuid NOT NULL REFERENCES users(id),
  role text NOT NULL CHECK (role IN ('preparer', 'approver')),
  content_hash text NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE download_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pack_id uuid NOT NULL REFERENCES release_packs(id),
  client_id uuid NOT NULL REFERENCES clients(id),
  user_id uuid NOT NULL REFERENCES users(id),
  at timestamptz NOT NULL DEFAULT now(),
  ip_hash text,
  user_agent text
);

CREATE INDEX release_packs_period_idx ON release_packs (client_id, period_id, kind, version DESC);
CREATE INDEX pack_approvals_pack_idx ON pack_approvals (pack_id, at);
CREATE INDEX download_events_pack_idx ON download_events (pack_id, at DESC);

ALTER TABLE release_packs ENABLE ROW LEVEL SECURITY;
ALTER TABLE pack_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE download_events ENABLE ROW LEVEL SECURITY;

ALTER TABLE release_packs FORCE ROW LEVEL SECURITY;
ALTER TABLE pack_approvals FORCE ROW LEVEL SECURITY;
ALTER TABLE download_events FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['release_packs', 'pack_approvals', 'download_events']
  LOOP
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT USING (client_id IN (SELECT visible_client_ids()))',
      tbl || '_read', tbl
    );
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR INSERT WITH CHECK (client_id IN (SELECT visible_client_ids()) AND app_role() IN (''admin'', ''accountant''))',
      tbl || '_insert', tbl
    );
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR UPDATE USING (client_id IN (SELECT visible_client_ids()) AND app_role() IN (''admin'', ''accountant'')) WITH CHECK (client_id IN (SELECT visible_client_ids()) AND app_role() IN (''admin'', ''accountant''))',
      tbl || '_update', tbl
    );
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR DELETE USING (client_id IN (SELECT visible_client_ids()) AND app_role() IN (''admin'', ''accountant''))',
      tbl || '_delete', tbl
    );
  END LOOP;
END
$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON release_packs, pack_approvals, download_events
TO daftar_app, daftar_worker;
