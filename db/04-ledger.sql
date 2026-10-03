-- arnibooks Stage A ledger: periods, COA, journals, documents, extractions.
-- Applied after 01-schema.sql / 02-seed.sql / 03-profile-key.sql on fresh Compose volumes.

CREATE TABLE accounting_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id),
  label text NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  status text NOT NULL CHECK (status IN ('OPEN', 'CLOSED', 'REOPENED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (period_end >= period_start)
);

CREATE TABLE chart_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id),
  code text NOT NULL,
  name text NOT NULL,
  account_type text NOT NULL CHECK (account_type IN ('asset', 'liability', 'equity', 'income', 'expense')),
  is_ar boolean NOT NULL DEFAULT false,
  is_ap boolean NOT NULL DEFAULT false,
  is_vat_control boolean NOT NULL DEFAULT false,
  is_bank boolean NOT NULL DEFAULT false,
  vat201_box text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, code)
);

CREATE TABLE documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id),
  period_id uuid NOT NULL REFERENCES accounting_periods(id),
  file_id uuid REFERENCES files(id),
  doc_type text NOT NULL CHECK (doc_type IN (
    'SALES_INVOICE', 'PURCHASE_INVOICE', 'CREDIT_NOTE', 'BANK_STATEMENT', 'OTHER'
  )),
  original_name text NOT NULL,
  status text NOT NULL CHECK (status IN (
    'uploaded', 'extracted', 'needs_review', 'approved', 'posted', 'rejected'
  )),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE document_extractions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES clients(id),
  version int NOT NULL,
  facts_json jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('draft', 'approved', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  approved_by uuid REFERENCES users(id),
  UNIQUE (document_id, version)
);

CREATE TABLE journal_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id),
  period_id uuid NOT NULL REFERENCES accounting_periods(id),
  source_document_id uuid REFERENCES documents(id),
  source_extraction_id uuid REFERENCES document_extractions(id),
  source_file_id uuid REFERENCES files(id),
  memo text NOT NULL DEFAULT '',
  entry_date date NOT NULL,
  status text NOT NULL CHECK (status IN ('draft', 'posted')),
  content_hash text,
  created_by uuid NOT NULL REFERENCES users(id),
  posted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE journal_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id uuid NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES clients(id),
  account_id uuid NOT NULL REFERENCES chart_accounts(id),
  debit_minor bigint NOT NULL DEFAULT 0 CHECK (debit_minor >= 0),
  credit_minor bigint NOT NULL DEFAULT 0 CHECK (credit_minor >= 0),
  currency char(3) NOT NULL DEFAULT 'AED',
  vat201_box text,
  line_memo text NOT NULL DEFAULT '',
  CHECK (NOT (debit_minor > 0 AND credit_minor > 0)),
  CHECK (debit_minor > 0 OR credit_minor > 0)
);

CREATE INDEX accounting_periods_client_idx ON accounting_periods (client_id, period_start DESC);
CREATE INDEX chart_accounts_client_idx ON chart_accounts (client_id, code);
CREATE INDEX documents_period_idx ON documents (client_id, period_id, created_at DESC);
CREATE INDEX journal_entries_period_idx ON journal_entries (client_id, period_id, entry_date DESC);
CREATE INDEX journal_lines_entry_idx ON journal_lines (entry_id);
CREATE INDEX journal_lines_vat_box_idx ON journal_lines (client_id, vat201_box)
  WHERE vat201_box IS NOT NULL;

CREATE OR REPLACE FUNCTION assert_journal_balanced(p_entry_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  d bigint;
  c bigint;
  st text;
BEGIN
  SELECT status INTO st FROM journal_entries WHERE id = p_entry_id;
  IF st IS NULL THEN
    RAISE EXCEPTION 'journal_not_found';
  END IF;
  IF st <> 'posted' THEN
    RETURN;
  END IF;
  SELECT COALESCE(SUM(debit_minor), 0), COALESCE(SUM(credit_minor), 0)
  INTO d, c
  FROM journal_lines
  WHERE entry_id = p_entry_id;
  IF d = 0 AND c = 0 THEN
    RAISE EXCEPTION 'journal_empty';
  END IF;
  IF d <> c THEN
    RAISE EXCEPTION 'journal_unbalanced debit=% credit=%', d, c;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION trg_journal_entry_balanced()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM assert_journal_balanced(NEW.id);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION trg_journal_line_balanced()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  eid uuid;
BEGIN
  eid := COALESCE(NEW.entry_id, OLD.entry_id);
  PERFORM assert_journal_balanced(eid);
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE CONSTRAINT TRIGGER journal_entry_balanced
AFTER INSERT OR UPDATE OF status ON journal_entries
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION trg_journal_entry_balanced();

CREATE CONSTRAINT TRIGGER journal_line_balanced
AFTER INSERT OR UPDATE OR DELETE ON journal_lines
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION trg_journal_line_balanced();

ALTER TABLE accounting_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE chart_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_extractions ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_lines ENABLE ROW LEVEL SECURITY;

ALTER TABLE accounting_periods FORCE ROW LEVEL SECURITY;
ALTER TABLE chart_accounts FORCE ROW LEVEL SECURITY;
ALTER TABLE documents FORCE ROW LEVEL SECURITY;
ALTER TABLE document_extractions FORCE ROW LEVEL SECURITY;
ALTER TABLE journal_entries FORCE ROW LEVEL SECURITY;
ALTER TABLE journal_lines FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'accounting_periods', 'chart_accounts', 'documents',
    'document_extractions', 'journal_entries', 'journal_lines'
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
  accounting_periods, chart_accounts, documents, document_extractions,
  journal_entries, journal_lines
TO daftar_app, daftar_worker;

GRANT EXECUTE ON FUNCTION assert_journal_balanced(uuid) TO daftar_app, daftar_worker;
