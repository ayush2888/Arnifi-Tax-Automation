-- Stage C: parties, AR/AP open items, recon matches, exception queue.

CREATE TABLE parties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id),
  name text NOT NULL,
  party_type text NOT NULL CHECK (party_type IN ('customer', 'supplier', 'other')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, name, party_type)
);

CREATE TABLE open_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id),
  period_id uuid NOT NULL REFERENCES accounting_periods(id),
  party_id uuid NOT NULL REFERENCES parties(id),
  side text NOT NULL CHECK (side IN ('AR', 'AP')),
  document_id uuid REFERENCES documents(id),
  journal_entry_id uuid REFERENCES journal_entries(id),
  journal_line_id uuid REFERENCES journal_lines(id),
  reference text NOT NULL DEFAULT '',
  original_minor bigint NOT NULL CHECK (original_minor > 0),
  outstanding_minor bigint NOT NULL CHECK (outstanding_minor >= 0),
  currency char(3) NOT NULL DEFAULT 'AED',
  opened_on date NOT NULL,
  status text NOT NULL CHECK (status IN ('OPEN', 'PARTIAL', 'CLEARED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (outstanding_minor <= original_minor)
);

CREATE TABLE recon_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id),
  period_id uuid REFERENCES accounting_periods(id),
  status text NOT NULL CHECK (status IN ('PROPOSED', 'CONFIRMED', 'VOID')),
  match_kind text NOT NULL CHECK (match_kind IN ('ONE_TO_ONE', 'ONE_TO_MANY', 'MANY_TO_ONE', 'PARTIAL')),
  note text NOT NULL DEFAULT '',
  created_by uuid NOT NULL REFERENCES users(id),
  confirmed_by uuid REFERENCES users(id),
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE recon_legs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES recon_groups(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES clients(id),
  leg_kind text NOT NULL CHECK (leg_kind IN ('BANK_TXN', 'OPEN_ITEM')),
  bank_transaction_id uuid REFERENCES bank_transactions(id),
  open_item_id uuid REFERENCES open_items(id),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  CHECK (
    (leg_kind = 'BANK_TXN' AND bank_transaction_id IS NOT NULL AND open_item_id IS NULL)
    OR (leg_kind = 'OPEN_ITEM' AND open_item_id IS NOT NULL AND bank_transaction_id IS NULL)
  )
);

CREATE TABLE recon_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id),
  period_id uuid REFERENCES accounting_periods(id),
  kind text NOT NULL CHECK (kind IN (
    'UNMATCHED_BANK', 'UNMATCHED_OPEN_ITEM', 'CONTROL_BREAK', 'STALE', 'OTHER'
  )),
  status text NOT NULL CHECK (status IN ('OPEN', 'RESOLVED')),
  bank_transaction_id uuid REFERENCES bank_transactions(id),
  open_item_id uuid REFERENCES open_items(id),
  message text NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  resolved_by uuid REFERENCES users(id),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX parties_client_idx ON parties (client_id, name);
CREATE INDEX open_items_client_idx ON open_items (client_id, side, status, opened_on);
CREATE INDEX recon_groups_client_idx ON recon_groups (client_id, status, created_at DESC);
CREATE INDEX recon_legs_group_idx ON recon_legs (group_id);
CREATE INDEX recon_exceptions_client_idx ON recon_exceptions (client_id, status, created_at DESC);

ALTER TABLE parties ENABLE ROW LEVEL SECURITY;
ALTER TABLE open_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE recon_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE recon_legs ENABLE ROW LEVEL SECURITY;
ALTER TABLE recon_exceptions ENABLE ROW LEVEL SECURITY;

ALTER TABLE parties FORCE ROW LEVEL SECURITY;
ALTER TABLE open_items FORCE ROW LEVEL SECURITY;
ALTER TABLE recon_groups FORCE ROW LEVEL SECURITY;
ALTER TABLE recon_legs FORCE ROW LEVEL SECURITY;
ALTER TABLE recon_exceptions FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'parties', 'open_items', 'recon_groups', 'recon_legs', 'recon_exceptions'
  ]
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

GRANT SELECT, INSERT, UPDATE, DELETE ON
  parties, open_items, recon_groups, recon_legs, recon_exceptions
TO daftar_app, daftar_worker;
