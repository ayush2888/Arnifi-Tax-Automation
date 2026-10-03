-- Phase 0 close-out: JE numbering, bidirectional reversal links, COA template + hierarchy.

-- Rename legacy reversal_of → reverses_entry_id; add reversed_by_entry_id.
ALTER TABLE books_journal_entries
  ADD COLUMN IF NOT EXISTS entry_no text,
  ADD COLUMN IF NOT EXISTS reverses_entry_id uuid REFERENCES books_journal_entries(id),
  ADD COLUMN IF NOT EXISTS reversed_by_entry_id uuid REFERENCES books_journal_entries(id),
  ADD COLUMN IF NOT EXISTS entry_type text NOT NULL DEFAULT 'manual'
    CHECK (entry_type IN ('manual', 'auto', 'closing', 'opening', 'reversal')),
  ADD COLUMN IF NOT EXISTS note text NOT NULL DEFAULT '';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'books_journal_entries' AND column_name = 'reversal_of'
  ) THEN
    ALTER TABLE books_journal_entries DISABLE TRIGGER USER;
    UPDATE books_journal_entries SET reverses_entry_id = reversal_of WHERE reverses_entry_id IS NULL;
    ALTER TABLE books_journal_entries DROP COLUMN reversal_of;
    ALTER TABLE books_journal_entries ENABLE TRIGGER USER;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS books_journal_entries_entry_no_uidx
  ON books_journal_entries (client_id, entry_no)
  WHERE entry_no IS NOT NULL;

-- Gapless JE-YYYY-#### per company per calendar year (row-locked sequence).
CREATE TABLE IF NOT EXISTS books_entry_sequences (
  client_id uuid NOT NULL REFERENCES clients(id),
  year int NOT NULL CHECK (year >= 2000 AND year <= 2100),
  last_n int NOT NULL DEFAULT 0 CHECK (last_n >= 0),
  PRIMARY KEY (client_id, year)
);

ALTER TABLE books_entry_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE books_entry_sequences FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS books_entry_sequences_all ON books_entry_sequences;
DROP POLICY IF EXISTS books_entry_sequences_read ON books_entry_sequences;
CREATE POLICY books_entry_sequences_all ON books_entry_sequences FOR ALL
  USING (client_id IN (SELECT visible_client_ids()) AND app_role() IN ('admin', 'accountant'))
  WITH CHECK (client_id IN (SELECT visible_client_ids()) AND app_role() IN ('admin', 'accountant'));
CREATE POLICY books_entry_sequences_read ON books_entry_sequences FOR SELECT
  USING (client_id IN (SELECT visible_client_ids()));

GRANT SELECT, INSERT, UPDATE ON books_entry_sequences TO daftar_app, daftar_worker;

CREATE OR REPLACE FUNCTION books_next_entry_no(p_client_id uuid, p_year int)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  n int;
BEGIN
  INSERT INTO books_entry_sequences (client_id, year, last_n)
  VALUES (p_client_id, p_year, 0)
  ON CONFLICT (client_id, year) DO NOTHING;

  SELECT last_n INTO n
  FROM books_entry_sequences
  WHERE client_id = p_client_id AND year = p_year
  FOR UPDATE;

  n := n + 1;
  UPDATE books_entry_sequences SET last_n = n
  WHERE client_id = p_client_id AND year = p_year;

  RETURN 'JE-' || p_year::text || '-' || lpad(n::text, 4, '0');
END;
$$;

GRANT EXECUTE ON FUNCTION books_next_entry_no(uuid, int) TO daftar_app, daftar_worker;

-- Immutability trigger must use reverses_entry_id (reversal_of dropped above).
-- Allow: memo/note edits; posted→reversed with reversed_by_entry_id; draft→posted with entry_no.
CREATE OR REPLACE FUNCTION trg_books_posted_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  st text;
BEGIN
  IF TG_TABLE_NAME = 'books_journal_lines' THEN
    SELECT status INTO st FROM books_journal_entries WHERE id = COALESCE(NEW.entry_id, OLD.entry_id);
    IF st IN ('posted', 'reversed') THEN
      RAISE EXCEPTION 'books_posted_immutable';
    END IF;
  ELSIF TG_TABLE_NAME = 'books_journal_entries' THEN
    IF TG_OP = 'UPDATE' AND OLD.status IN ('posted', 'reversed') THEN
      IF OLD.status = 'posted' AND NEW.status = 'reversed'
         AND NEW.reversed_by_entry_id IS NOT NULL THEN
        RETURN NEW;
      END IF;
      -- Gapless JE# backfill / assign-at-post when entry_no was null.
      IF NEW.status = OLD.status
         AND OLD.entry_no IS NULL
         AND NEW.entry_no IS NOT NULL
         AND NEW.period_id = OLD.period_id
         AND NEW.entry_date = OLD.entry_date
         AND NEW.memo IS NOT DISTINCT FROM OLD.memo
         AND NEW.note IS NOT DISTINCT FROM OLD.note
         AND NEW.reverses_entry_id IS NOT DISTINCT FROM OLD.reverses_entry_id
         AND NEW.reversed_by_entry_id IS NOT DISTINCT FROM OLD.reversed_by_entry_id
         AND NEW.content_hash IS NOT DISTINCT FROM OLD.content_hash
         AND NEW.created_by = OLD.created_by THEN
        RETURN NEW;
      END IF;
      IF NEW.status = OLD.status
         AND NEW.period_id = OLD.period_id
         AND NEW.entry_date = OLD.entry_date
         AND NEW.reverses_entry_id IS NOT DISTINCT FROM OLD.reverses_entry_id
         AND NEW.reversed_by_entry_id IS NOT DISTINCT FROM OLD.reversed_by_entry_id
         AND NEW.entry_no IS NOT DISTINCT FROM OLD.entry_no
         AND NEW.content_hash IS NOT DISTINCT FROM OLD.content_hash
         AND NEW.created_by = OLD.created_by
         AND NEW.posted_at IS NOT DISTINCT FROM OLD.posted_at
         AND (
           NEW.memo IS DISTINCT FROM OLD.memo
           OR NEW.note IS DISTINCT FROM OLD.note
         ) THEN
        RETURN NEW;
      END IF;
      RAISE EXCEPTION 'books_posted_immutable';
    END IF;
    IF TG_OP = 'DELETE' AND OLD.status IN ('posted', 'reversed') THEN
      RAISE EXCEPTION 'books_posted_immutable';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- COA hierarchy + UAE SME template
ALTER TABLE books_accounts
  ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES books_accounts(id),
  ADD COLUMN IF NOT EXISTS is_postable boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS normal_balance text CHECK (normal_balance IN ('debit', 'credit')),
  ADD COLUMN IF NOT EXISTS cash_flow_class text,
  ADD COLUMN IF NOT EXISTS statement_line text,
  ADD COLUMN IF NOT EXISTS note_group text,
  ADD COLUMN IF NOT EXISTS is_control boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS template_code text;

CREATE TABLE IF NOT EXISTS books_coa_template (
  code text PRIMARY KEY,
  name text NOT NULL,
  account_type text NOT NULL CHECK (account_type IN ('asset', 'liability', 'equity', 'income', 'expense')),
  parent_code text,
  is_postable boolean NOT NULL DEFAULT true,
  normal_balance text NOT NULL CHECK (normal_balance IN ('debit', 'credit')),
  is_ar boolean NOT NULL DEFAULT false,
  is_ap boolean NOT NULL DEFAULT false,
  is_vat_control boolean NOT NULL DEFAULT false,
  is_bank boolean NOT NULL DEFAULT false,
  is_control boolean NOT NULL DEFAULT false,
  cash_flow_class text,
  statement_line text,
  note_group text,
  sort_order int NOT NULL DEFAULT 0
);

TRUNCATE books_coa_template;
INSERT INTO books_coa_template (
  code, name, account_type, parent_code, is_postable, normal_balance,
  is_bank, is_ar, is_ap, is_vat_control, is_control, cash_flow_class, statement_line, note_group, sort_order
) VALUES
  ('1000', 'Cash & bank', 'asset', NULL, false, 'debit', false, false, false, false, true, 'operating', 'BS_current_assets', 'cash', 10),
  ('1001', 'Operating bank AED', 'asset', '1000', true, 'debit', true, false, false, false, false, 'operating', 'BS_current_assets', 'cash', 11),
  ('1002', 'USD bank', 'asset', '1000', true, 'debit', true, false, false, false, false, 'operating', 'BS_current_assets', 'cash', 12),
  ('1100', 'Accounts receivable', 'asset', NULL, false, 'debit', false, false, false, false, true, 'operating', 'BS_current_assets', 'receivables', 20),
  ('1101', 'Trade receivables', 'asset', '1100', true, 'debit', false, true, false, false, false, 'operating', 'BS_current_assets', 'receivables', 21),
  ('1200', 'Other current assets', 'asset', NULL, false, 'debit', false, false, false, false, true, 'operating', 'BS_current_assets', 'other_ca', 30),
  ('1201', 'Disbursement clearing', 'asset', '1200', true, 'debit', false, false, false, false, false, 'operating', 'BS_current_assets', 'other_ca', 31),
  ('1202', 'Gateway clearing', 'asset', '1200', true, 'debit', false, false, false, false, false, 'operating', 'BS_current_assets', 'other_ca', 32),
  ('1203', 'VAT input recoverable', 'asset', '1200', true, 'debit', false, false, false, true, false, 'operating', 'BS_current_assets', 'vat', 33),
  ('1300', 'Inventory', 'asset', NULL, true, 'debit', false, false, false, false, false, 'operating', 'BS_current_assets', 'inventory', 40),
  ('1500', 'Non-current assets', 'asset', NULL, false, 'debit', false, false, false, false, true, 'investing', 'BS_nca', 'fa', 50),
  ('1501', 'Furniture & equipment', 'asset', '1500', true, 'debit', false, false, false, false, false, 'investing', 'BS_nca', 'fa', 51),
  ('1502', 'Accumulated depreciation', 'asset', '1500', true, 'credit', false, false, false, false, false, 'investing', 'BS_nca', 'fa', 52),
  ('2000', 'Accounts payable', 'liability', NULL, false, 'credit', false, false, false, false, true, 'operating', 'BS_current_liab', 'payables', 60),
  ('2001', 'Trade payables', 'liability', '2000', true, 'credit', false, false, true, false, false, 'operating', 'BS_current_liab', 'payables', 61),
  ('2100', 'Tax & statutory', 'liability', NULL, false, 'credit', false, false, false, false, true, 'operating', 'BS_current_liab', 'tax', 70),
  ('2101', 'VAT output', 'liability', '2100', true, 'credit', false, false, false, true, false, 'operating', 'BS_current_liab', 'tax', 71),
  ('2102', 'Corporate tax payable', 'liability', '2100', true, 'credit', false, false, false, false, false, 'operating', 'BS_current_liab', 'tax', 72),
  ('2200', 'Other liabilities', 'liability', NULL, false, 'credit', false, false, false, false, true, 'financing', 'BS_current_liab', 'other_cl', 80),
  ('2201', 'Credit card payable', 'liability', '2200', true, 'credit', false, false, false, false, false, 'financing', 'BS_current_liab', 'other_cl', 81),
  ('2202', 'Accrued expenses', 'liability', '2200', true, 'credit', false, false, false, false, false, 'operating', 'BS_current_liab', 'other_cl', 82),
  ('3000', 'Equity', 'equity', NULL, false, 'credit', false, false, false, false, true, 'financing', 'BS_equity', 'equity', 90),
  ('3001', 'Owner capital', 'equity', '3000', true, 'credit', false, false, false, false, false, 'financing', 'BS_equity', 'equity', 91),
  ('3002', 'Retained earnings', 'equity', '3000', true, 'credit', false, false, false, false, false, 'financing', 'BS_equity', 'equity', 92),
  ('4000', 'Revenue', 'income', NULL, false, 'credit', false, false, false, false, true, 'operating', 'PL_revenue', 'revenue', 100),
  ('4001', 'Service revenue', 'income', '4000', true, 'credit', false, false, false, false, false, 'operating', 'PL_revenue', 'revenue', 101),
  ('4002', 'Trading sales', 'income', '4000', true, 'credit', false, false, false, false, false, 'operating', 'PL_revenue', 'revenue', 102),
  ('4003', 'Rental income', 'income', '4000', true, 'credit', false, false, false, false, false, 'operating', 'PL_revenue', 'revenue', 103),
  ('5000', 'Cost of sales', 'expense', NULL, false, 'debit', false, false, false, false, true, 'operating', 'PL_cogs', 'cogs', 110),
  ('5001', 'Cost of goods sold', 'expense', '5000', true, 'debit', false, false, false, false, false, 'operating', 'PL_cogs', 'cogs', 111),
  ('5100', 'Operating expenses', 'expense', NULL, false, 'debit', false, false, false, false, true, 'operating', 'PL_opex', 'opex', 120),
  ('5101', 'Salaries & wages', 'expense', '5100', true, 'debit', false, false, false, false, false, 'operating', 'PL_opex', 'opex', 121),
  ('5102', 'Rent expense', 'expense', '5100', true, 'debit', false, false, false, false, false, 'operating', 'PL_opex', 'opex', 122),
  ('5103', 'Utilities', 'expense', '5100', true, 'debit', false, false, false, false, false, 'operating', 'PL_opex', 'opex', 123),
  ('5104', 'Bank charges', 'expense', '5100', true, 'debit', false, false, false, false, false, 'operating', 'PL_opex', 'opex', 124),
  ('5105', 'Payment gateway fees', 'expense', '5100', true, 'debit', false, false, false, false, false, 'operating', 'PL_opex', 'opex', 125),
  ('5106', 'Depreciation', 'expense', '5100', true, 'debit', false, false, false, false, false, 'operating', 'PL_opex', 'opex', 126),
  ('5107', 'General & admin', 'expense', '5100', true, 'debit', false, false, false, false, false, 'operating', 'PL_opex', 'opex', 127),
  ('1190', 'Suspense', 'asset', '1200', true, 'debit', false, false, false, false, false, 'operating', 'BS_current_assets', 'other_ca', 34);

GRANT SELECT ON books_coa_template TO daftar_app, daftar_worker;

-- Reject journal lines on non-postable accounts.
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

DROP TRIGGER IF EXISTS books_journal_lines_postable ON books_journal_lines;
CREATE TRIGGER books_journal_lines_postable
BEFORE INSERT OR UPDATE OF account_id ON books_journal_lines
FOR EACH ROW EXECUTE FUNCTION trg_books_line_postable();

-- Block hard-delete of accounts with postings; use active=false instead.
CREATE OR REPLACE FUNCTION trg_books_account_delete_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM books_journal_lines WHERE account_id = OLD.id LIMIT 1) THEN
    RAISE EXCEPTION 'books_account_has_postings';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS books_accounts_delete_guard ON books_accounts;
CREATE TRIGGER books_accounts_delete_guard
BEFORE DELETE ON books_accounts
FOR EACH ROW EXECUTE FUNCTION trg_books_account_delete_guard();

-- Copy UAE SME template onto a client (idempotent by template_code / code).
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
      is_ar, is_ap, is_vat_control, is_bank, is_control, cash_flow_class,
      statement_line, note_group, template_code, active
    ) VALUES (
      p_client_id, r.code, r.name, r.account_type, parent, r.is_postable, r.normal_balance,
      r.is_ar, r.is_ap, r.is_vat_control, r.is_bank, r.is_control, r.cash_flow_class,
      r.statement_line, r.note_group, r.code, true
    )
    ON CONFLICT (client_id, code) DO UPDATE SET
      name = EXCLUDED.name,
      parent_id = EXCLUDED.parent_id,
      is_postable = EXCLUDED.is_postable,
      normal_balance = EXCLUDED.normal_balance,
      template_code = EXCLUDED.template_code;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION books_copy_coa_template(uuid) TO daftar_app, daftar_worker;

-- Copy UAE SME template onto synthetic books companies.
SELECT books_copy_coa_template('e1000001-0000-4000-8000-000000000001');
SELECT books_copy_coa_template('e1000001-0000-4000-8000-000000000002');
SELECT books_copy_coa_template('e1000001-0000-4000-8000-000000000003');

-- Backfill gapless JE numbers for seed posted entries (ordered).
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT id, client_id, EXTRACT(YEAR FROM entry_date)::int AS y
    FROM books_journal_entries
    WHERE entry_no IS NULL AND status IN ('posted', 'reversed')
    ORDER BY client_id, entry_date, created_at
  LOOP
    UPDATE books_journal_entries
    SET entry_no = books_next_entry_no(r.client_id, r.y)
    WHERE id = r.id;
  END LOOP;
END $$;

-- Company profile edits from Settings (accountant/admin on visible clients).
DROP POLICY IF EXISTS clients_update ON clients;
CREATE POLICY clients_update ON clients FOR UPDATE
  USING (id IN (SELECT visible_client_ids()) AND app_role() IN ('admin', 'accountant'))
  WITH CHECK (id IN (SELECT visible_client_ids()) AND app_role() IN ('admin', 'accountant'));
GRANT SELECT, UPDATE ON clients TO daftar_app, daftar_worker;

COMMENT ON TABLE books_coa_template IS 'Global UAE SME chart template; copied per company via books_copy_coa_template.';
COMMENT ON FUNCTION books_next_entry_no(uuid, int) IS 'Gapless JE-YYYY-#### under row lock.';
