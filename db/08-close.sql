-- Stage D1: accruals, fixed assets / depreciation, period close checklist + reopen audit.

ALTER TABLE accounting_periods
  ADD COLUMN IF NOT EXISTS closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS closed_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS reopened_at timestamptz,
  ADD COLUMN IF NOT EXISTS reopened_by uuid REFERENCES users(id);

CREATE TABLE accrual_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id),
  period_id uuid NOT NULL REFERENCES accounting_periods(id),
  kind text NOT NULL CHECK (kind IN ('ACCRUAL', 'PREPAYMENT')),
  memo text NOT NULL DEFAULT '',
  debit_account_id uuid NOT NULL REFERENCES chart_accounts(id),
  credit_account_id uuid NOT NULL REFERENCES chart_accounts(id),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  auto_reverse boolean NOT NULL DEFAULT true,
  status text NOT NULL CHECK (status IN ('DRAFT', 'PROPOSED', 'POSTED', 'REVERSED', 'WAIVED')),
  journal_entry_id uuid REFERENCES journal_entries(id),
  reverse_journal_entry_id uuid REFERENCES journal_entries(id),
  created_by uuid NOT NULL REFERENCES users(id),
  posted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE fixed_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id),
  code text NOT NULL,
  name text NOT NULL,
  cost_minor bigint NOT NULL CHECK (cost_minor > 0),
  residual_minor bigint NOT NULL DEFAULT 0 CHECK (residual_minor >= 0),
  life_months int NOT NULL CHECK (life_months > 0),
  method text NOT NULL CHECK (method IN ('STRAIGHT_LINE')),
  in_service_on date NOT NULL,
  asset_account_id uuid NOT NULL REFERENCES chart_accounts(id),
  accum_depr_account_id uuid NOT NULL REFERENCES chart_accounts(id),
  depr_expense_account_id uuid NOT NULL REFERENCES chart_accounts(id),
  status text NOT NULL CHECK (status IN ('ACTIVE', 'DISPOSED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, code),
  CHECK (residual_minor < cost_minor)
);

CREATE TABLE depreciation_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id),
  asset_id uuid NOT NULL REFERENCES fixed_assets(id) ON DELETE CASCADE,
  period_id uuid NOT NULL REFERENCES accounting_periods(id),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  status text NOT NULL CHECK (status IN ('PLANNED', 'PROPOSED', 'POSTED', 'WAIVED')),
  journal_entry_id uuid REFERENCES journal_entries(id),
  posted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (asset_id, period_id)
);

CREATE TABLE period_close_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id),
  period_id uuid NOT NULL REFERENCES accounting_periods(id),
  action text NOT NULL CHECK (action IN ('CLOSE', 'REOPEN', 'WAIVE')),
  actor_id uuid NOT NULL REFERENCES users(id),
  reason text NOT NULL DEFAULT '',
  ticket_ref text NOT NULL DEFAULT '',
  checklist_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX accrual_schedules_period_idx ON accrual_schedules (client_id, period_id, status);
CREATE INDEX fixed_assets_client_idx ON fixed_assets (client_id, status);
CREATE INDEX depreciation_schedules_period_idx ON depreciation_schedules (client_id, period_id, status);
CREATE INDEX period_close_events_period_idx ON period_close_events (client_id, period_id, at DESC);

ALTER TABLE accrual_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE fixed_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE depreciation_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE period_close_events ENABLE ROW LEVEL SECURITY;

ALTER TABLE accrual_schedules FORCE ROW LEVEL SECURITY;
ALTER TABLE fixed_assets FORCE ROW LEVEL SECURITY;
ALTER TABLE depreciation_schedules FORCE ROW LEVEL SECURITY;
ALTER TABLE period_close_events FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'accrual_schedules', 'fixed_assets', 'depreciation_schedules', 'period_close_events'
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
  accrual_schedules, fixed_assets, depreciation_schedules, period_close_events
TO daftar_app, daftar_worker;
