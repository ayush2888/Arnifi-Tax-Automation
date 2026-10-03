-- UAE SME COA v2 + books tags/views/attachments/jobs/recurring.

ALTER TABLE books_accounts
  ADD COLUMN IF NOT EXISTS sub_type text,
  ADD COLUMN IF NOT EXISTS is_contra boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS default_vat_code text,
  ADD COLUMN IF NOT EXISTS currency char(3) NOT NULL DEFAULT 'AED';

ALTER TABLE books_journal_entries
  ADD COLUMN IF NOT EXISTS reference text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS scheduled_for date,
  ADD COLUMN IF NOT EXISTS auto_reverse_next_period boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS template_key text,
  ADD COLUMN IF NOT EXISTS recurring_id uuid;

ALTER TABLE books_journal_lines
  ADD COLUMN IF NOT EXISTS vat_code text,
  ADD COLUMN IF NOT EXISTS vat_amount_minor bigint NOT NULL DEFAULT 0 CHECK (vat_amount_minor >= 0),
  ADD COLUMN IF NOT EXISTS linked_vat_line_id uuid;

CREATE TABLE IF NOT EXISTS books_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id),
  name text NOT NULL,
  colour text NOT NULL DEFAULT '#6B7280',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, name)
);

CREATE TABLE IF NOT EXISTS books_journal_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id uuid NOT NULL REFERENCES books_journal_entries(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES clients(id),
  file_id uuid NOT NULL REFERENCES files(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entry_id, file_id)
);

CREATE TABLE IF NOT EXISTS books_saved_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id),
  user_id uuid NOT NULL REFERENCES users(id),
  name text NOT NULL,
  scope text NOT NULL DEFAULT 'personal' CHECK (scope IN ('personal', 'shared')),
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, user_id, name)
);

CREATE TABLE IF NOT EXISTS books_recurring_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id),
  period_id uuid NOT NULL REFERENCES books_periods(id),
  memo text NOT NULL DEFAULT '',
  frequency text NOT NULL CHECK (frequency IN ('monthly', 'quarterly', 'yearly')),
  start_date date NOT NULL,
  occurrences int NOT NULL CHECK (occurrences >= 1 AND occurrences <= 120),
  next_date date NOT NULL,
  remaining int NOT NULL,
  line_payload jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid NOT NULL REFERENCES users(id),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS books_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id),
  kind text NOT NULL CHECK (kind IN ('schedule_post', 'recurring_materialize', 'auto_reverse')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  run_at timestamptz NOT NULL DEFAULT now(),
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE INDEX IF NOT EXISTS books_jobs_queued_idx ON books_jobs (run_at) WHERE status = 'queued';

ALTER TABLE books_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE books_tags FORCE ROW LEVEL SECURITY;
ALTER TABLE books_journal_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE books_journal_attachments FORCE ROW LEVEL SECURITY;
ALTER TABLE books_saved_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE books_saved_views FORCE ROW LEVEL SECURITY;
ALTER TABLE books_recurring_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE books_recurring_templates FORCE ROW LEVEL SECURITY;
ALTER TABLE books_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE books_jobs FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'books_tags', 'books_journal_attachments', 'books_saved_views',
    'books_recurring_templates', 'books_jobs'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_all', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL USING (client_id IN (SELECT visible_client_ids()) AND app_role() IN (''admin'', ''accountant'')) WITH CHECK (client_id IN (SELECT visible_client_ids()) AND app_role() IN (''admin'', ''accountant''))',
      t || '_all', t
    );
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_read', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT USING (client_id IN (SELECT visible_client_ids()))',
      t || '_read', t
    );
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  books_tags, books_journal_attachments, books_saved_views, books_recurring_templates, books_jobs
TO daftar_app, daftar_worker;

-- Strengthen postable/control guard (headers blocked; control flagged — Phase 0 still allows post to controls).
CREATE OR REPLACE FUNCTION trg_books_line_postable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  postable boolean;
BEGIN
  SELECT is_postable INTO postable FROM books_accounts WHERE id = NEW.account_id;
  IF postable IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'books_account_not_postable';
  END IF;
  RETURN NEW;
END;
$$;

-- Child code must fall in parent numeric range (4-digit codes).
CREATE OR REPLACE FUNCTION trg_books_account_range()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  p_code text;
  c int;
  p int;
  lo int;
  hi int;
BEGIN
  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT code INTO p_code FROM books_accounts WHERE id = NEW.parent_id;
  IF p_code IS NULL OR NEW.code !~ '^\d{4}$' OR p_code !~ '^\d{4}$' THEN
    RETURN NEW;
  END IF;
  c := NEW.code::int;
  p := p_code::int;
  -- Parent range: e.g. 1100 → 1100..1199; 1000 → 1000..1999 if ends with 000 else xx00..xx99
  IF p % 1000 = 0 THEN
    lo := p; hi := p + 999;
  ELSIF p % 100 = 0 THEN
    lo := p; hi := p + 99;
  ELSE
    lo := p; hi := p;
  END IF;
  IF c < lo OR c > hi THEN
    RAISE EXCEPTION 'books_account_code_out_of_parent_range child=% parent=%', NEW.code, p_code;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS books_accounts_range ON books_accounts;
CREATE TRIGGER books_accounts_range
BEFORE INSERT OR UPDATE OF code, parent_id ON books_accounts
FOR EACH ROW EXECUTE FUNCTION trg_books_account_range();

CREATE OR REPLACE FUNCTION books_claim_job()
RETURNS books_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  j books_jobs;
BEGIN
  SELECT * INTO j FROM books_jobs
  WHERE status = 'queued' AND run_at <= now()
  ORDER BY run_at
  FOR UPDATE SKIP LOCKED
  LIMIT 1;
  IF j.id IS NULL THEN
    RETURN NULL;
  END IF;
  UPDATE books_jobs SET status = 'running' WHERE id = j.id RETURNING * INTO j;
  RETURN j;
END;
$$;
GRANT EXECUTE ON FUNCTION books_claim_job() TO daftar_app, daftar_worker;

CREATE OR REPLACE FUNCTION books_complete_job(p_id uuid, p_status text, p_error text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_status NOT IN ('done', 'failed') THEN
    RAISE EXCEPTION 'books_job_bad_status';
  END IF;
  UPDATE books_jobs
  SET status = p_status, finished_at = now(), error = p_error
  WHERE id = p_id;
END;
$$;
GRANT EXECUTE ON FUNCTION books_complete_job(uuid, text, text) TO daftar_app, daftar_worker;

CREATE OR REPLACE FUNCTION books_job_actor(p_entry_id uuid, p_template_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid;
BEGIN
  IF p_entry_id IS NOT NULL THEN
    SELECT created_by INTO actor FROM books_journal_entries WHERE id = p_entry_id;
    IF actor IS NOT NULL THEN
      RETURN actor;
    END IF;
  END IF;
  IF p_template_id IS NOT NULL THEN
    SELECT created_by INTO actor FROM books_recurring_templates WHERE id = p_template_id;
    RETURN actor;
  END IF;
  RETURN NULL;
END;
$$;
GRANT EXECUTE ON FUNCTION books_job_actor(uuid, uuid) TO daftar_app, daftar_worker;

-- Replace COA template with v2 hierarchy.
TRUNCATE books_coa_template;
ALTER TABLE books_coa_template ADD COLUMN IF NOT EXISTS sub_type text;
ALTER TABLE books_coa_template ADD COLUMN IF NOT EXISTS is_contra boolean NOT NULL DEFAULT false;
ALTER TABLE books_coa_template ADD COLUMN IF NOT EXISTS default_vat_code text;

INSERT INTO books_coa_template (
  code, name, account_type, parent_code, is_postable, normal_balance,
  is_bank, is_ar, is_ap, is_vat_control, is_control, is_contra, sub_type,
  cash_flow_class, statement_line, note_group, default_vat_code, sort_order
) VALUES
  -- ASSETS
  ('1000', 'ASSETS', 'asset', NULL, false, 'debit', false, false, false, false, true, false, 'header', NULL, 'BS_assets', 'assets', NULL, 1000),
  ('1100', 'Cash & Bank', 'asset', '1000', false, 'debit', false, false, false, false, true, false, 'cash_bank', 'operating', 'BS_current_assets', 'cash', NULL, 1100),
  ('1110', 'Petty cash', 'asset', '1100', true, 'debit', true, false, false, false, false, false, 'cash', 'operating', 'BS_current_assets', 'cash', NULL, 1110),
  ('1120', 'Bank - AED current', 'asset', '1100', true, 'debit', true, false, false, false, false, false, 'bank', 'operating', 'BS_current_assets', 'cash', NULL, 1120),
  ('1121', 'Bank - USD', 'asset', '1100', true, 'debit', true, false, false, false, false, false, 'bank', 'operating', 'BS_current_assets', 'cash', NULL, 1121),
  ('1130', 'Credit card clearing', 'asset', '1100', true, 'debit', false, false, false, false, false, false, 'clearing', 'operating', 'BS_current_assets', 'cash', NULL, 1130),
  ('1200', 'Receivables', 'asset', '1000', false, 'debit', false, false, false, false, true, false, 'receivables', 'operating', 'BS_current_assets', 'receivables', NULL, 1200),
  ('1210', 'Trade receivables', 'asset', '1200', true, 'debit', false, true, false, false, true, false, 'ar_control', 'operating', 'BS_current_assets', 'receivables', NULL, 1210),
  ('1220', 'Client disbursements recoverable', 'asset', '1200', true, 'debit', false, false, false, false, false, false, 'disbursement', 'operating', 'BS_current_assets', 'receivables', NULL, 1220),
  ('1230', 'Employee advances', 'asset', '1200', true, 'debit', false, false, false, false, false, false, 'advance', 'operating', 'BS_current_assets', 'receivables', NULL, 1230),
  ('1240', 'Shareholder / owner current account (debit)', 'asset', '1200', true, 'debit', false, false, false, false, false, false, 'owner', 'financing', 'BS_current_assets', 'receivables', NULL, 1240),
  ('1300', 'Clearing', 'asset', '1000', false, 'debit', false, false, false, false, true, false, 'clearing', 'operating', 'BS_current_assets', 'clearing', NULL, 1300),
  ('1310', 'Payment gateway clearing (Stripe)', 'asset', '1300', true, 'debit', false, false, false, false, false, false, 'gateway', 'operating', 'BS_current_assets', 'clearing', NULL, 1310),
  ('1320', 'Payment gateway clearing (Nomod)', 'asset', '1300', true, 'debit', false, false, false, false, false, false, 'gateway', 'operating', 'BS_current_assets', 'clearing', NULL, 1320),
  ('1330', 'POS clearing', 'asset', '1300', true, 'debit', false, false, false, false, false, false, 'pos', 'operating', 'BS_current_assets', 'clearing', NULL, 1330),
  ('1340', 'Inter-bank transfers clearing', 'asset', '1300', true, 'debit', false, false, false, false, false, false, 'transfer', 'operating', 'BS_current_assets', 'clearing', NULL, 1340),
  ('1390', 'Suspense', 'asset', '1300', true, 'debit', false, false, false, false, false, false, 'suspense', 'operating', 'BS_current_assets', 'clearing', NULL, 1390),
  ('1400', 'Prepayments & other current', 'asset', '1000', false, 'debit', false, false, false, false, true, false, 'prepay', 'operating', 'BS_current_assets', 'other_ca', NULL, 1400),
  ('1410', 'Prepaid expenses', 'asset', '1400', true, 'debit', false, false, false, false, false, false, 'prepay', 'operating', 'BS_current_assets', 'other_ca', NULL, 1410),
  ('1420', 'Deposits', 'asset', '1400', true, 'debit', false, false, false, false, false, false, 'deposit', 'operating', 'BS_current_assets', 'other_ca', NULL, 1420),
  ('1430', 'VAT input recoverable', 'asset', '1400', true, 'debit', false, false, false, true, true, false, 'vat_input', 'operating', 'BS_current_assets', 'vat', 'SR', 1430),
  ('1440', 'VAT receivable (refund due)', 'asset', '1400', true, 'debit', false, false, false, true, false, false, 'vat_refund', 'operating', 'BS_current_assets', 'vat', NULL, 1440),
  ('1500', 'Inventory', 'asset', '1000', false, 'debit', false, false, false, false, true, false, 'inventory', 'operating', 'BS_current_assets', 'inventory', NULL, 1500),
  ('1510', 'Finished goods', 'asset', '1500', true, 'debit', false, false, false, false, false, false, 'inventory', 'operating', 'BS_current_assets', 'inventory', NULL, 1510),
  ('1520', 'Raw materials', 'asset', '1500', true, 'debit', false, false, false, false, false, false, 'inventory', 'operating', 'BS_current_assets', 'inventory', NULL, 1520),
  ('1600', 'Fixed assets', 'asset', '1000', false, 'debit', false, false, false, false, true, false, 'fa', 'investing', 'BS_nca', 'fa', NULL, 1600),
  ('1610', 'Furniture & fixtures', 'asset', '1600', true, 'debit', false, false, false, false, false, false, 'fa', 'investing', 'BS_nca', 'fa', NULL, 1610),
  ('1620', 'Computers & IT', 'asset', '1600', true, 'debit', false, false, false, false, false, false, 'fa', 'investing', 'BS_nca', 'fa', NULL, 1620),
  ('1630', 'Vehicles', 'asset', '1600', true, 'debit', false, false, false, false, false, false, 'fa', 'investing', 'BS_nca', 'fa', NULL, 1630),
  ('1640', 'Leasehold improvements', 'asset', '1600', true, 'debit', false, false, false, false, false, false, 'fa', 'investing', 'BS_nca', 'fa', NULL, 1640),
  ('1690', 'Accumulated depreciation', 'asset', '1600', true, 'credit', false, false, false, false, false, true, 'fa_contra', 'investing', 'BS_nca', 'fa', NULL, 1690),
  ('1700', 'Intangible assets', 'asset', '1000', false, 'debit', false, false, false, false, true, false, 'ia', 'investing', 'BS_nca', 'ia', NULL, 1700),
  ('1710', 'Software & licences', 'asset', '1700', true, 'debit', false, false, false, false, false, false, 'ia', 'investing', 'BS_nca', 'ia', NULL, 1710),
  ('1790', 'Accumulated amortisation', 'asset', '1700', true, 'credit', false, false, false, false, false, true, 'ia_contra', 'investing', 'BS_nca', 'ia', NULL, 1790),
  -- LIABILITIES
  ('2000', 'LIABILITIES', 'liability', NULL, false, 'credit', false, false, false, false, true, false, 'header', NULL, 'BS_liab', 'liab', NULL, 2000),
  ('2100', 'Payables', 'liability', '2000', false, 'credit', false, false, false, false, true, false, 'payables', 'operating', 'BS_current_liab', 'payables', NULL, 2100),
  ('2110', 'Trade payables', 'liability', '2100', true, 'credit', false, false, true, false, true, false, 'ap_control', 'operating', 'BS_current_liab', 'payables', 'SR', 2110),
  ('2120', 'Accrued expenses', 'liability', '2100', true, 'credit', false, false, false, false, false, false, 'accrual', 'operating', 'BS_current_liab', 'payables', NULL, 2120),
  ('2130', 'Employee reimbursable', 'liability', '2100', true, 'credit', false, false, false, false, false, false, 'employee', 'operating', 'BS_current_liab', 'payables', NULL, 2130),
  ('2140', 'Government fees payable', 'liability', '2100', true, 'credit', false, false, false, false, false, false, 'gov', 'operating', 'BS_current_liab', 'payables', NULL, 2140),
  ('2150', 'Credit card payable', 'liability', '2100', true, 'credit', false, false, false, false, false, false, 'card', 'financing', 'BS_current_liab', 'payables', NULL, 2150),
  ('2200', 'Tax', 'liability', '2000', false, 'credit', false, false, false, false, true, false, 'tax', 'operating', 'BS_current_liab', 'tax', NULL, 2200),
  ('2210', 'VAT output', 'liability', '2200', true, 'credit', false, false, false, true, true, false, 'vat_output', 'operating', 'BS_current_liab', 'tax', 'SR', 2210),
  ('2220', 'VAT payable (settlement)', 'liability', '2200', true, 'credit', false, false, false, true, false, false, 'vat_settle', 'operating', 'BS_current_liab', 'tax', NULL, 2220),
  ('2230', 'Corporate tax payable', 'liability', '2200', true, 'credit', false, false, false, false, false, false, 'ct', 'operating', 'BS_current_liab', 'tax', NULL, 2230),
  ('2300', 'Other current', 'liability', '2000', false, 'credit', false, false, false, false, true, false, 'other_cl', 'operating', 'BS_current_liab', 'other_cl', NULL, 2300),
  ('2310', 'Deferred revenue', 'liability', '2300', true, 'credit', false, false, false, false, false, false, 'deferred', 'operating', 'BS_current_liab', 'other_cl', NULL, 2310),
  ('2320', 'Customer advances', 'liability', '2300', true, 'credit', false, false, false, false, false, false, 'advance', 'operating', 'BS_current_liab', 'other_cl', NULL, 2320),
  ('2330', 'Salaries payable', 'liability', '2300', true, 'credit', false, false, false, false, false, false, 'payroll', 'operating', 'BS_current_liab', 'other_cl', NULL, 2330),
  ('2340', 'Owner current account (credit)', 'liability', '2300', true, 'credit', false, false, false, false, false, false, 'owner', 'financing', 'BS_current_liab', 'other_cl', NULL, 2340),
  ('2400', 'Non-current', 'liability', '2000', false, 'credit', false, false, false, false, true, false, 'ncl', 'financing', 'BS_ncl', 'ncl', NULL, 2400),
  ('2410', 'End-of-service gratuity provision', 'liability', '2400', true, 'credit', false, false, false, false, false, false, 'eosb', 'operating', 'BS_ncl', 'ncl', NULL, 2410),
  ('2420', 'Long-term loans', 'liability', '2400', true, 'credit', false, false, false, false, false, false, 'loan', 'financing', 'BS_ncl', 'ncl', NULL, 2420),
  -- EQUITY
  ('3000', 'EQUITY', 'equity', NULL, false, 'credit', false, false, false, false, true, false, 'header', 'financing', 'BS_equity', 'equity', NULL, 3000),
  ('3100', 'Share capital', 'equity', '3000', true, 'credit', false, false, false, false, false, false, 'capital', 'financing', 'BS_equity', 'equity', NULL, 3100),
  ('3200', 'Retained earnings', 'equity', '3000', true, 'credit', false, false, false, false, false, false, 're', 'financing', 'BS_equity', 'equity', NULL, 3200),
  ('3300', 'Current year earnings', 'equity', '3000', true, 'credit', false, false, false, false, false, false, 'cye', 'financing', 'BS_equity', 'equity', NULL, 3300),
  ('3400', 'Owner drawings', 'equity', '3000', true, 'debit', false, false, false, false, false, true, 'drawings', 'financing', 'BS_equity', 'equity', NULL, 3400),
  ('3900', 'Opening balance equity', 'equity', '3000', true, 'credit', false, false, false, false, false, false, 'obe', 'financing', 'BS_equity', 'equity', NULL, 3900),
  -- REVENUE
  ('4000', 'REVENUE', 'income', NULL, false, 'credit', false, false, false, false, true, false, 'header', 'operating', 'PL_revenue', 'revenue', NULL, 4000),
  ('4100', 'Service revenue', 'income', '4000', true, 'credit', false, false, false, false, false, false, 'service', 'operating', 'PL_revenue', 'revenue', 'SR', 4100),
  ('4200', 'Product sales', 'income', '4000', true, 'credit', false, false, false, false, false, false, 'product', 'operating', 'PL_revenue', 'revenue', 'SR', 4200),
  ('4300', 'Rental income', 'income', '4000', true, 'credit', false, false, false, false, false, false, 'rental', 'operating', 'PL_revenue', 'revenue', 'SR', 4300),
  ('4900', 'Sales returns & discounts', 'income', '4000', true, 'debit', false, false, false, false, false, true, 'contra_rev', 'operating', 'PL_revenue', 'revenue', 'SR', 4900),
  -- COS
  ('5000', 'COST OF SALES', 'expense', NULL, false, 'debit', false, false, false, false, true, false, 'header', 'operating', 'PL_cogs', 'cogs', NULL, 5000),
  ('5100', 'Cost of goods sold', 'expense', '5000', true, 'debit', false, false, false, false, false, false, 'cogs', 'operating', 'PL_cogs', 'cogs', NULL, 5100),
  ('5200', 'Direct labour/subcontractors', 'expense', '5000', true, 'debit', false, false, false, false, false, false, 'direct', 'operating', 'PL_cogs', 'cogs', 'SR', 5200),
  ('5300', 'Freight & customs', 'expense', '5000', true, 'debit', false, false, false, false, false, false, 'freight', 'operating', 'PL_cogs', 'cogs', 'SR', 5300),
  -- OPEX
  ('6000', 'OPERATING EXPENSES', 'expense', NULL, false, 'debit', false, false, false, false, true, false, 'header', 'operating', 'PL_opex', 'opex', NULL, 6000),
  ('6100', 'Salaries & wages', 'expense', '6000', true, 'debit', false, false, false, false, false, false, 'payroll', 'operating', 'PL_opex', 'opex', NULL, 6100),
  ('6110', 'Employee benefits & EOSB', 'expense', '6000', true, 'debit', false, false, false, false, false, false, 'payroll', 'operating', 'PL_opex', 'opex', NULL, 6110),
  ('6120', 'Visa & labour costs', 'expense', '6000', true, 'debit', false, false, false, false, false, false, 'payroll', 'operating', 'PL_opex', 'opex', NULL, 6120),
  ('6200', 'Rent', 'expense', '6000', true, 'debit', false, false, false, false, false, false, 'premises', 'operating', 'PL_opex', 'opex', 'SR', 6200),
  ('6210', 'Utilities', 'expense', '6000', true, 'debit', false, false, false, false, false, false, 'premises', 'operating', 'PL_opex', 'opex', 'SR', 6210),
  ('6220', 'Telecom & internet', 'expense', '6000', true, 'debit', false, false, false, false, false, false, 'premises', 'operating', 'PL_opex', 'opex', 'SR', 6220),
  ('6300', 'Software & subscriptions', 'expense', '6000', true, 'debit', false, false, false, false, false, false, 'it', 'operating', 'PL_opex', 'opex', 'SR', 6300),
  ('6310', 'IT & hosting', 'expense', '6000', true, 'debit', false, false, false, false, false, false, 'it', 'operating', 'PL_opex', 'opex', 'SR', 6310),
  ('6400', 'Professional fees', 'expense', '6000', true, 'debit', false, false, false, false, false, false, 'prof', 'operating', 'PL_opex', 'opex', 'SR', 6400),
  ('6410', 'Accounting & audit', 'expense', '6000', true, 'debit', false, false, false, false, false, false, 'prof', 'operating', 'PL_opex', 'opex', 'SR', 6410),
  ('6420', 'Licence & government fees', 'expense', '6000', true, 'debit', false, false, false, false, false, false, 'gov', 'operating', 'PL_opex', 'opex', NULL, 6420),
  ('6500', 'Marketing & advertising', 'expense', '6000', true, 'debit', false, false, false, false, false, false, 'marketing', 'operating', 'PL_opex', 'opex', 'SR', 6500),
  ('6510', 'Travel', 'expense', '6000', true, 'debit', false, false, false, false, false, false, 'travel', 'operating', 'PL_opex', 'opex', 'SR', 6510),
  ('6520', 'Meals & entertainment', 'expense', '6000', true, 'debit', false, false, false, false, false, false, 'travel', 'operating', 'PL_opex', 'opex', 'SR', 6520),
  ('6600', 'Office supplies', 'expense', '6000', true, 'debit', false, false, false, false, false, false, 'office', 'operating', 'PL_opex', 'opex', 'SR', 6600),
  ('6610', 'Repairs & maintenance', 'expense', '6000', true, 'debit', false, false, false, false, false, false, 'office', 'operating', 'PL_opex', 'opex', 'SR', 6610),
  ('6700', 'Insurance', 'expense', '6000', true, 'debit', false, false, false, false, false, false, 'insurance', 'operating', 'PL_opex', 'opex', 'SR', 6700),
  ('6800', 'Depreciation', 'expense', '6000', true, 'debit', false, false, false, false, false, false, 'depr', 'operating', 'PL_opex', 'opex', NULL, 6800),
  ('6810', 'Amortisation', 'expense', '6000', true, 'debit', false, false, false, false, false, false, 'amort', 'operating', 'PL_opex', 'opex', NULL, 6810),
  ('6900', 'Bank charges', 'expense', '6000', true, 'debit', false, false, false, false, false, false, 'bank', 'operating', 'PL_opex', 'opex', NULL, 6900),
  ('6910', 'Payment gateway fees', 'expense', '6000', true, 'debit', false, false, false, false, false, false, 'bank', 'operating', 'PL_opex', 'opex', NULL, 6910),
  -- OTHER
  ('7000', 'OTHER INCOME / EXPENSE', 'expense', NULL, false, 'debit', false, false, false, false, true, false, 'header', 'operating', 'PL_other', 'other', NULL, 7000),
  ('7100', 'Interest income', 'income', '7000', true, 'credit', false, false, false, false, false, false, 'interest', 'operating', 'PL_other', 'other', NULL, 7100),
  ('7200', 'Other income', 'income', '7000', true, 'credit', false, false, false, false, false, false, 'other_inc', 'operating', 'PL_other', 'other', NULL, 7200),
  ('7300', 'FX gain/loss - realised', 'expense', '7000', true, 'debit', false, false, false, false, false, false, 'fx', 'operating', 'PL_other', 'other', NULL, 7300),
  ('7310', 'FX gain/loss - unrealised', 'expense', '7000', true, 'debit', false, false, false, false, false, false, 'fx', 'operating', 'PL_other', 'other', NULL, 7310),
  ('7400', 'Interest expense', 'expense', '7000', true, 'debit', false, false, false, false, false, false, 'interest', 'financing', 'PL_other', 'other', NULL, 7400),
  ('7500', 'Gain/loss on disposal', 'expense', '7000', true, 'debit', false, false, false, false, false, false, 'disposal', 'investing', 'PL_other', 'other', NULL, 7500),
  ('8000', 'TAX', 'expense', NULL, false, 'debit', false, false, false, false, true, false, 'header', 'operating', 'PL_tax', 'tax', NULL, 8000),
  ('8100', 'Corporate tax expense', 'expense', '8000', true, 'debit', false, false, false, false, false, false, 'ct', 'operating', 'PL_tax', 'tax', NULL, 8100);

-- Remap journal leaf codes (old → new) keeping UUIDs. Headers rebuilt by copy.
ALTER TABLE books_accounts DISABLE TRIGGER books_accounts_range;
DO $$
DECLARE
  m record;
  cid uuid;
BEGIN
  -- Clear parent links so renames cannot violate range mid-flight.
  UPDATE books_accounts SET parent_id = NULL;

  FOR m IN
    SELECT * FROM (VALUES
      ('1001', '1120'), ('1002', '1121'), ('1101', '1210'), ('1190', '1390'),
      ('1201', '1220'), ('1202', '1310'), ('1203', '1430'), ('1300', '1510'),
      ('1501', '1610'), ('1502', '1690'), ('2001', '2110'), ('2101', '2210'),
      ('2102', '2230'), ('2201', '2150'), ('2202', '2120'), ('3001', '3100'),
      ('3002', '3200'), ('4001', '4100'), ('4002', '4200'), ('4003', '4300'),
      ('5001', '5100'), ('5101', '6100'), ('5102', '6200'), ('5103', '6210'),
      ('5104', '6900'), ('5105', '6910'), ('5106', '6800'), ('5107', '6600')
    ) AS v(old_code, new_code)
  LOOP
    -- If target code exists on another row without postings, retire it.
    UPDATE books_accounts SET code = m.new_code || '_retire_v2', active = false
    WHERE code = m.new_code
      AND NOT EXISTS (SELECT 1 FROM books_journal_lines l WHERE l.account_id = books_accounts.id)
      AND NOT EXISTS (SELECT 1 FROM books_accounts x WHERE x.client_id = books_accounts.client_id AND x.code = m.old_code);

    UPDATE books_accounts SET code = m.new_code
    WHERE code = m.old_code
      AND NOT EXISTS (
        SELECT 1 FROM books_accounts x
        WHERE x.client_id = books_accounts.client_id AND x.code = m.new_code AND x.id <> books_accounts.id
      );
  END LOOP;

  -- Drop unused retired rows.
  DELETE FROM books_accounts a
  WHERE a.code LIKE '%_retire_v2'
    AND NOT EXISTS (SELECT 1 FROM books_journal_lines l WHERE l.account_id = a.id);

  -- Deactivate obsolete v1-only codes that are not in the v2 template
  -- (v2 reuses many header codes like 1000/2000 — those are refreshed by copy below).
  UPDATE books_accounts a SET active = false
  WHERE NOT EXISTS (SELECT 1 FROM books_coa_template t WHERE t.code = a.code)
    AND NOT EXISTS (SELECT 1 FROM books_journal_lines l WHERE l.account_id = a.id)
    AND a.is_postable = false;
END $$;
ALTER TABLE books_accounts ENABLE TRIGGER books_accounts_range;

CREATE OR REPLACE FUNCTION books_copy_coa_template(p_client_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  r record;
  parent uuid;
BEGIN
  FOR r IN SELECT * FROM books_coa_template ORDER BY sort_order, code LOOP
    parent := NULL;
    IF r.parent_code IS NOT NULL THEN
      SELECT id INTO parent FROM books_accounts
      WHERE client_id = p_client_id AND code = r.parent_code;
    END IF;
    INSERT INTO books_accounts (
      client_id, code, name, account_type, parent_id, is_postable, normal_balance,
      is_ar, is_ap, is_vat_control, is_bank, is_control, is_contra, sub_type,
      cash_flow_class, statement_line, note_group, template_code, default_vat_code,
      currency, active
    ) VALUES (
      p_client_id, r.code, r.name, r.account_type, parent, r.is_postable, r.normal_balance,
      r.is_ar, r.is_ap, r.is_vat_control, r.is_bank, r.is_control, COALESCE(r.is_contra, false), r.sub_type,
      r.cash_flow_class, r.statement_line, r.note_group, r.code, r.default_vat_code,
      'AED', true
    )
    ON CONFLICT (client_id, code) DO UPDATE SET
      name = EXCLUDED.name,
      parent_id = EXCLUDED.parent_id,
      is_postable = EXCLUDED.is_postable,
      normal_balance = EXCLUDED.normal_balance,
      is_control = EXCLUDED.is_control,
      is_contra = EXCLUDED.is_contra,
      sub_type = EXCLUDED.sub_type,
      default_vat_code = EXCLUDED.default_vat_code,
      template_code = EXCLUDED.template_code,
      is_ar = EXCLUDED.is_ar,
      is_ap = EXCLUDED.is_ap,
      is_vat_control = EXCLUDED.is_vat_control,
      is_bank = EXCLUDED.is_bank,
      active = true;
  END LOOP;
END;
$$;

SELECT books_copy_coa_template('e1000001-0000-4000-8000-000000000001');
SELECT books_copy_coa_template('e1000001-0000-4000-8000-000000000002');
SELECT books_copy_coa_template('e1000001-0000-4000-8000-000000000003');

-- Default tags for Desert Falcon
INSERT INTO books_tags (client_id, name, colour) VALUES
  ('e1000001-0000-4000-8000-000000000001', 'ops', '#1F5BD8'),
  ('e1000001-0000-4000-8000-000000000001', 'vat', '#D97706'),
  ('e1000001-0000-4000-8000-000000000001', 'payroll', '#7C3AED')
ON CONFLICT DO NOTHING;
