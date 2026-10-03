-- arnibooks Phase 1: parallel books ledger (does NOT write legacy journal_* tables).

CREATE TABLE books_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id),
  label text NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  status text NOT NULL CHECK (status IN ('OPEN', 'LOCKED', 'REOPENED')),
  reopen_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (period_end >= period_start),
  UNIQUE (client_id, label)
);

CREATE TABLE books_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id),
  code text NOT NULL,
  name text NOT NULL,
  account_type text NOT NULL CHECK (account_type IN ('asset', 'liability', 'equity', 'income', 'expense')),
  is_ar boolean NOT NULL DEFAULT false,
  is_ap boolean NOT NULL DEFAULT false,
  is_vat_control boolean NOT NULL DEFAULT false,
  is_bank boolean NOT NULL DEFAULT false,
  vat_class text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, code)
);

CREATE TABLE books_journal_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id),
  period_id uuid NOT NULL REFERENCES books_periods(id),
  memo text NOT NULL DEFAULT '',
  entry_date date NOT NULL,
  status text NOT NULL CHECK (status IN ('draft', 'posted', 'reversed')),
  reversal_of uuid REFERENCES books_journal_entries(id),
  content_hash text,
  created_by uuid NOT NULL REFERENCES users(id),
  posted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE books_journal_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id uuid NOT NULL REFERENCES books_journal_entries(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES clients(id),
  account_id uuid NOT NULL REFERENCES books_accounts(id),
  debit_minor bigint NOT NULL DEFAULT 0 CHECK (debit_minor >= 0),
  credit_minor bigint NOT NULL DEFAULT 0 CHECK (credit_minor >= 0),
  currency char(3) NOT NULL DEFAULT 'AED',
  original_minor bigint,
  fx_rate_scaled bigint,
  aed_minor bigint,
  line_memo text NOT NULL DEFAULT '',
  vat_treatment text,
  tags text[] NOT NULL DEFAULT '{}',
  CHECK (NOT (debit_minor > 0 AND credit_minor > 0)),
  CHECK (debit_minor > 0 OR credit_minor > 0)
);

CREATE TABLE books_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id),
  actor uuid NOT NULL REFERENCES users(id),
  action text NOT NULL,
  entity text NOT NULL,
  entity_id uuid NOT NULL,
  before_json jsonb,
  after_json jsonb,
  source text NOT NULL DEFAULT 'app',
  at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX books_periods_client_idx ON books_periods (client_id, period_start DESC);
CREATE INDEX books_accounts_client_idx ON books_accounts (client_id, code);
CREATE INDEX books_journal_entries_period_idx ON books_journal_entries (client_id, period_id, entry_date DESC);
CREATE INDEX books_journal_lines_entry_idx ON books_journal_lines (entry_id);
CREATE INDEX books_audit_events_entity_idx ON books_audit_events (client_id, entity, entity_id, at DESC);

-- Balance check for posted entries only.
CREATE OR REPLACE FUNCTION assert_books_journal_balanced(p_entry_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  d bigint;
  c bigint;
  st text;
BEGIN
  SELECT status INTO st FROM books_journal_entries WHERE id = p_entry_id;
  IF st IS NULL THEN
    RAISE EXCEPTION 'books_journal_not_found';
  END IF;
  IF st <> 'posted' THEN
    RETURN;
  END IF;
  SELECT COALESCE(SUM(debit_minor), 0), COALESCE(SUM(credit_minor), 0)
  INTO d, c
  FROM books_journal_lines
  WHERE entry_id = p_entry_id;
  IF d = 0 AND c = 0 THEN
    RAISE EXCEPTION 'books_journal_empty';
  END IF;
  IF d <> c THEN
    RAISE EXCEPTION 'books_journal_unbalanced debit=% credit=%', d, c;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION trg_books_journal_entry_balanced()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM assert_books_journal_balanced(NEW.id);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION trg_books_journal_line_balanced()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  eid uuid;
BEGIN
  eid := COALESCE(NEW.entry_id, OLD.entry_id);
  PERFORM assert_books_journal_balanced(eid);
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE CONSTRAINT TRIGGER books_journal_entry_balanced
AFTER INSERT OR UPDATE OF status ON books_journal_entries
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION trg_books_journal_entry_balanced();

CREATE CONSTRAINT TRIGGER books_journal_line_balanced
AFTER INSERT OR UPDATE OR DELETE ON books_journal_lines
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION trg_books_journal_line_balanced();

-- Posted immutability: lines of posted/reversed entries cannot change; status cannot leave posted except to reversed via controlled path.
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
      IF NEW.status = OLD.status
         AND NEW.period_id = OLD.period_id
         AND NEW.entry_date = OLD.entry_date
         AND NEW.reversal_of IS NOT DISTINCT FROM OLD.reversal_of
         AND NEW.content_hash IS NOT DISTINCT FROM OLD.content_hash
         AND NEW.created_by = OLD.created_by
         AND NEW.posted_at IS NOT DISTINCT FROM OLD.posted_at
         AND NEW.memo IS DISTINCT FROM OLD.memo THEN
        -- memo-only edit allowed on posted (audited in app)
        RETURN NEW;
      END IF;
      IF OLD.status = 'posted' AND NEW.status = 'reversed' THEN
        RETURN NEW;
      END IF;
      IF NEW.memo IS DISTINCT FROM OLD.memo
         AND NEW.status = OLD.status
         AND NEW.period_id = OLD.period_id
         AND NEW.entry_date = OLD.entry_date THEN
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

CREATE TRIGGER books_journal_entries_immutable
BEFORE UPDATE OR DELETE ON books_journal_entries
FOR EACH ROW EXECUTE FUNCTION trg_books_posted_immutable();

CREATE TRIGGER books_journal_lines_immutable
BEFORE INSERT OR UPDATE OR DELETE ON books_journal_lines
FOR EACH ROW EXECUTE FUNCTION trg_books_posted_immutable();

-- Period lock: block new/changed activity into LOCKED periods.
CREATE OR REPLACE FUNCTION trg_books_period_lock()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  st text;
  pid uuid;
BEGIN
  pid := COALESCE(NEW.period_id, OLD.period_id);
  SELECT status INTO st FROM books_periods WHERE id = pid;
  IF st = 'LOCKED' THEN
    RAISE EXCEPTION 'books_period_locked';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER books_journal_entries_period_lock
BEFORE INSERT OR UPDATE ON books_journal_entries
FOR EACH ROW EXECUTE FUNCTION trg_books_period_lock();

ALTER TABLE books_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE books_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE books_journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE books_journal_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE books_audit_events ENABLE ROW LEVEL SECURITY;

ALTER TABLE books_periods FORCE ROW LEVEL SECURITY;
ALTER TABLE books_accounts FORCE ROW LEVEL SECURITY;
ALTER TABLE books_journal_entries FORCE ROW LEVEL SECURITY;
ALTER TABLE books_journal_lines FORCE ROW LEVEL SECURITY;
ALTER TABLE books_audit_events FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'books_periods', 'books_accounts', 'books_journal_entries',
    'books_journal_lines', 'books_audit_events'
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

-- Viewers can read audit; only admin/accountant write (policies above). Allow viewer SELECT already via read policy.

GRANT SELECT, INSERT, UPDATE, DELETE ON
  books_periods, books_accounts, books_journal_entries, books_journal_lines, books_audit_events
TO daftar_app, daftar_worker;

GRANT EXECUTE ON FUNCTION assert_books_journal_balanced(uuid) TO daftar_app, daftar_worker;
