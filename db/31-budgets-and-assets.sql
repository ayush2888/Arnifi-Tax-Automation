-- Budgets (per period and account) and a fixed-asset register with straight-line depreciation.
-- Depreciation is computed on read from these rows; nothing here posts journals.

CREATE TABLE IF NOT EXISTS books_budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id),
  period_id uuid NOT NULL REFERENCES books_periods(id),
  account_id uuid NOT NULL REFERENCES books_accounts(id),
  amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (period_id, account_id)
);
CREATE INDEX IF NOT EXISTS books_budgets_client_period_idx ON books_budgets (client_id, period_id);

CREATE TABLE IF NOT EXISTS books_fixed_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id),
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  category text NOT NULL CHECK (category IN (
    'furniture', 'equipment', 'vehicles', 'it_hardware', 'buildings', 'leasehold', 'other'
  )),
  acquisition_date date NOT NULL,
  cost_minor bigint NOT NULL CHECK (cost_minor > 0),
  residual_minor bigint NOT NULL DEFAULT 0 CHECK (residual_minor >= 0 AND residual_minor <= cost_minor),
  useful_life_months integer NOT NULL CHECK (useful_life_months BETWEEN 1 AND 600),
  disposal_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (disposal_date IS NULL OR disposal_date >= acquisition_date)
);
CREATE INDEX IF NOT EXISTS books_fixed_assets_client_idx ON books_fixed_assets (client_id, acquisition_date);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['books_budgets', 'books_fixed_assets'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_read', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_write', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT USING (client_id IN (SELECT visible_client_ids()))',
      t || '_read', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL USING (client_id IN (SELECT visible_client_ids()) AND app_role() IN (''admin'', ''accountant'')) WITH CHECK (client_id IN (SELECT visible_client_ids()) AND app_role() IN (''admin'', ''accountant''))',
      t || '_write', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO daftar_app, daftar_worker', t);
  END LOOP;
END $$;
