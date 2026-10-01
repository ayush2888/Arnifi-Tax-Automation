-- Daftar phase 1 schema.
-- Application roles do not own these tables and do not bypass row-level security.
-- The migration role (database owner / superuser) bypasses RLS so this file can seed later.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'daftar_app') THEN
    CREATE ROLE daftar_app LOGIN PASSWORD 'daftar-local-only' NOSUPERUSER NOBYPASSRLS NOCREATEDB;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'daftar_worker') THEN
    CREATE ROLE daftar_worker LOGIN PASSWORD 'daftar-local-only' NOSUPERUSER NOBYPASSRLS NOCREATEDB;
  END IF;
END
$$;

DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO daftar_app, daftar_worker', current_database());
END
$$;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO daftar_app, daftar_worker;

-- Session helpers. SECURITY DEFINER functions read access tables as the owner,
-- so policies can call them without recursive RLS.

CREATE OR REPLACE FUNCTION app_user_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.current_user_id', true), '')::uuid
$$;

CREATE TABLE firms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id uuid NOT NULL REFERENCES firms(id),
  name text NOT NULL,
  trn text,
  default_currency char(3) NOT NULL DEFAULT 'AED',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id uuid NOT NULL REFERENCES firms(id),
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'accountant', 'viewer')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_client_access (
  user_id uuid NOT NULL REFERENCES users(id),
  client_id uuid NOT NULL REFERENCES clients(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, client_id)
);

CREATE TABLE bank_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id),
  bank_name text NOT NULL,
  label text NOT NULL,
  iban_encrypted bytea,
  iban_masked text NOT NULL,
  currency char(3) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id),
  sha256 text NOT NULL,
  original_name text NOT NULL,
  detected_mime text NOT NULL,
  size bigint NOT NULL,
  storage_key text NOT NULL,
  uploaded_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, sha256)
);

CREATE TABLE statements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id),
  bank_account_id uuid NOT NULL REFERENCES bank_accounts(id),
  file_id uuid NOT NULL REFERENCES files(id),
  period_start date,
  period_end date,
  opening_minor bigint,
  closing_minor bigint,
  currency char(3) NOT NULL DEFAULT 'AED',
  status text NOT NULL CHECK (status IN ('uploaded', 'parsing', 'parsed', 'needs_review', 'approved', 'failed')),
  extraction_method text CHECK (extraction_method IS NULL OR extraction_method IN ('csv', 'xlsx', 'pdf_text', 'ocr', 'mixed')),
  page_count int,
  error text,
  proposed_mapping jsonb,
  validation_flags text[] NOT NULL DEFAULT '{}',
  extracted_row_count int,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE parser_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id uuid NOT NULL REFERENCES firms(id),
  bank_name text NOT NULL,
  column_map jsonb NOT NULL,
  date_format text,
  decimal_separator text NOT NULL DEFAULT '.',
  thousands_separator text NOT NULL DEFAULT ',',
  encoding text,
  version int NOT NULL,
  confirmed_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id uuid NOT NULL REFERENCES firms(id),
  client_id uuid REFERENCES clients(id),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id uuid NOT NULL REFERENCES firms(id),
  client_id uuid REFERENCES clients(id),
  match_type text NOT NULL CHECK (match_type IN ('contains', 'regex', 'exact')),
  pattern text NOT NULL,
  category_id uuid NOT NULL REFERENCES categories(id),
  version int NOT NULL DEFAULT 1,
  priority int NOT NULL DEFAULT 100,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE bank_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id),
  statement_id uuid NOT NULL REFERENCES statements(id) ON DELETE CASCADE,
  row_no int NOT NULL,
  source_page int,
  source_bbox jsonb,
  txn_date date,
  value_date date,
  description_raw text NOT NULL DEFAULT '',
  description_clean text NOT NULL DEFAULT '',
  counterparty text,
  reference text,
  debit_minor bigint,
  credit_minor bigint,
  balance_minor bigint,
  currency char(3) NOT NULL,
  txn_type text NOT NULL CHECK (txn_type IN ('debit', 'credit', 'unknown')),
  category_id uuid REFERENCES categories(id),
  vat_code text,
  class_status text NOT NULL DEFAULT 'unclassified' CHECK (class_status IN ('unclassified', 'proposed', 'confirmed')),
  review_status text NOT NULL DEFAULT 'ok' CHECK (review_status IN ('ok', 'needs_review', 'approved')),
  flags text[] NOT NULL DEFAULT '{}',
  extraction_confidence numeric(5, 4),
  dedupe_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (statement_id, row_no)
);

CREATE TABLE corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id),
  bank_transaction_id uuid NOT NULL REFERENCES bank_transactions(id) ON DELETE CASCADE,
  field text NOT NULL,
  old_value text,
  new_value text,
  user_id uuid NOT NULL REFERENCES users(id),
  saved_as_rule boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id uuid NOT NULL REFERENCES firms(id),
  client_id uuid REFERENCES clients(id),
  entity text NOT NULL,
  entity_id uuid,
  action text NOT NULL,
  actor uuid,
  diff jsonb,
  at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE processing_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id),
  file_id uuid NOT NULL REFERENCES files(id),
  statement_id uuid REFERENCES statements(id) ON DELETE CASCADE,
  stage text NOT NULL,
  method text NOT NULL,
  pages int NOT NULL DEFAULT 0,
  est_cost_usd numeric(12, 6) NOT NULL DEFAULT 0,
  duration_ms int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Staging for a parse, so confirming a column map does not OCR the file again.
CREATE TABLE statement_extractions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id),
  statement_id uuid NOT NULL REFERENCES statements(id) ON DELETE CASCADE,
  row_no int NOT NULL,
  source_page int,
  source_bbox jsonb,
  cells jsonb NOT NULL,
  confidence numeric(5, 4),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (statement_id, row_no)
);

CREATE TABLE statement_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id),
  statement_id uuid NOT NULL REFERENCES statements(id) ON DELETE CASCADE,
  page_no int NOT NULL,
  storage_key text NOT NULL,
  width int NOT NULL,
  height int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (statement_id, page_no)
);

CREATE TABLE saved_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id),
  user_id uuid NOT NULL REFERENCES users(id),
  name text NOT NULL,
  config jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Operational queue. Passwords are never written here.
CREATE TABLE jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id),
  statement_id uuid NOT NULL REFERENCES statements(id) ON DELETE CASCADE,
  file_id uuid NOT NULL REFERENCES files(id),
  uploaded_by uuid NOT NULL REFERENCES users(id),
  kind text NOT NULL CHECK (kind IN ('ingest', 'confirm')),
  status text NOT NULL CHECK (status IN ('queued', 'running', 'done', 'failed')),
  payload jsonb,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz
);

CREATE OR REPLACE FUNCTION app_firm_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT firm_id FROM users WHERE id = app_user_id()
$$;

CREATE OR REPLACE FUNCTION app_role() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM users WHERE id = app_user_id()
$$;

CREATE OR REPLACE FUNCTION visible_client_ids() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT client_id FROM user_client_access WHERE user_id = app_user_id()
$$;

CREATE INDEX bank_txn_client_date_idx ON bank_transactions (client_id, txn_date DESC, row_no DESC);
CREATE INDEX bank_txn_dedupe_idx ON bank_transactions (client_id, dedupe_hash);
CREATE INDEX bank_txn_statement_idx ON bank_transactions (statement_id);
CREATE INDEX statements_client_idx ON statements (client_id, created_at DESC);
CREATE INDEX jobs_queued_idx ON jobs (created_at) WHERE status = 'queued';
CREATE INDEX processing_events_file_idx ON processing_events (file_id, created_at);

CREATE OR REPLACE FUNCTION claim_job()
RETURNS TABLE (
  id uuid,
  client_id uuid,
  statement_id uuid,
  file_id uuid,
  uploaded_by uuid,
  kind text,
  payload jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  jid uuid;
BEGIN
  SELECT j.id INTO jid
  FROM jobs j
  WHERE j.status = 'queued'
  ORDER BY j.created_at
  FOR UPDATE SKIP LOCKED
  LIMIT 1;
  IF jid IS NULL THEN
    RETURN;
  END IF;
  UPDATE jobs AS j
  SET status = 'running', started_at = now()
  WHERE j.id = jid;
  RETURN QUERY
  SELECT j.id, j.client_id, j.statement_id, j.file_id, j.uploaded_by, j.kind, j.payload
  FROM jobs j
  WHERE j.id = jid;
END;
$$;

CREATE OR REPLACE FUNCTION complete_job(job_id uuid, job_status text, job_error text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF job_status NOT IN ('done', 'failed') THEN
    RAISE EXCEPTION 'bad job status';
  END IF;
  UPDATE jobs
  SET status = job_status,
      last_error = job_error,
      finished_at = now(),
      payload = NULL
  WHERE id = job_id;
END;
$$;

REVOKE ALL ON FUNCTION claim_job() FROM PUBLIC;
REVOKE ALL ON FUNCTION complete_job(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_job() TO daftar_worker;
GRANT EXECUTE ON FUNCTION complete_job(uuid, text, text) TO daftar_worker;
GRANT EXECUTE ON FUNCTION app_user_id() TO daftar_app, daftar_worker;
GRANT EXECUTE ON FUNCTION app_firm_id() TO daftar_app, daftar_worker;
GRANT EXECUTE ON FUNCTION app_role() TO daftar_app, daftar_worker;
GRANT EXECUTE ON FUNCTION visible_client_ids() TO daftar_app, daftar_worker;

-- Row-level security. Viewer can read. Admin and accountant can write.

ALTER TABLE firms ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_client_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE files ENABLE ROW LEVEL SECURITY;
ALTER TABLE statements ENABLE ROW LEVEL SECURITY;
ALTER TABLE parser_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE corrections ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE processing_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE statement_extractions ENABLE ROW LEVEL SECURITY;
ALTER TABLE statement_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY firms_read ON firms FOR SELECT USING (id = app_firm_id());

CREATE POLICY users_read ON users FOR SELECT USING (firm_id = app_firm_id());

CREATE POLICY access_read ON user_client_access FOR SELECT USING (user_id = app_user_id());

CREATE POLICY clients_read ON clients FOR SELECT USING (id IN (SELECT visible_client_ids()));

CREATE POLICY bank_accounts_read ON bank_accounts FOR SELECT
  USING (client_id IN (SELECT visible_client_ids()));

CREATE POLICY categories_read ON categories FOR SELECT
  USING (
    firm_id = app_firm_id()
    AND (client_id IS NULL OR client_id IN (SELECT visible_client_ids()))
  );

CREATE POLICY profiles_read ON parser_profiles FOR SELECT USING (firm_id = app_firm_id());
CREATE POLICY profiles_write ON parser_profiles FOR INSERT
  WITH CHECK (firm_id = app_firm_id() AND app_role() IN ('admin', 'accountant'));
CREATE POLICY profiles_update ON parser_profiles FOR UPDATE
  USING (firm_id = app_firm_id() AND app_role() IN ('admin', 'accountant'))
  WITH CHECK (firm_id = app_firm_id() AND app_role() IN ('admin', 'accountant'));

CREATE POLICY rules_read ON rules FOR SELECT
  USING (
    firm_id = app_firm_id()
    AND (client_id IS NULL OR client_id IN (SELECT visible_client_ids()))
  );
CREATE POLICY rules_insert ON rules FOR INSERT
  WITH CHECK (
    firm_id = app_firm_id()
    AND app_role() IN ('admin', 'accountant')
    AND (client_id IS NULL OR client_id IN (SELECT visible_client_ids()))
  );
CREATE POLICY rules_update ON rules FOR UPDATE
  USING (
    firm_id = app_firm_id()
    AND app_role() IN ('admin', 'accountant')
    AND (client_id IS NULL OR client_id IN (SELECT visible_client_ids()))
  )
  WITH CHECK (
    firm_id = app_firm_id()
    AND app_role() IN ('admin', 'accountant')
    AND (client_id IS NULL OR client_id IN (SELECT visible_client_ids()))
  );

CREATE POLICY views_all ON saved_views FOR ALL
  USING (user_id = app_user_id() AND client_id IN (SELECT visible_client_ids()))
  WITH CHECK (user_id = app_user_id() AND client_id IN (SELECT visible_client_ids()) AND app_role() IN ('admin', 'accountant', 'viewer'));

-- Viewer may store a personal view. Writes of financial rows stay with admin/accountant.
CREATE POLICY views_write_viewer ON saved_views FOR INSERT
  WITH CHECK (user_id = app_user_id() AND client_id IN (SELECT visible_client_ids()));
CREATE POLICY views_update_viewer ON saved_views FOR UPDATE
  USING (user_id = app_user_id() AND client_id IN (SELECT visible_client_ids()))
  WITH CHECK (user_id = app_user_id() AND client_id IN (SELECT visible_client_ids()));
CREATE POLICY views_delete_viewer ON saved_views FOR DELETE
  USING (user_id = app_user_id() AND client_id IN (SELECT visible_client_ids()));

-- The FOR ALL policy above already covers viewer writes. Drop the duplicate name collision
-- by not creating a second ALL. The three explicit policies plus ALL would OR together.
-- Keep a single ALL policy: drop the extra ones we just created if they duplicate.
DROP POLICY views_write_viewer ON saved_views;
DROP POLICY views_update_viewer ON saved_views;
DROP POLICY views_delete_viewer ON saved_views;

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'files', 'statements', 'bank_transactions', 'corrections', 'processing_events',
    'statement_extractions', 'statement_pages'
  ]
  LOOP
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT USING (client_id IN (SELECT visible_client_ids()))', tbl || '_read', tbl);
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

CREATE POLICY audit_read ON audit_log FOR SELECT
  USING (
    client_id IN (SELECT visible_client_ids())
    OR (client_id IS NULL AND firm_id = app_firm_id())
  );
CREATE POLICY audit_insert ON audit_log FOR INSERT
  WITH CHECK (
    firm_id = app_firm_id()
    AND app_role() IN ('admin', 'accountant')
    AND (client_id IS NULL OR client_id IN (SELECT visible_client_ids()))
  );

-- The app may enqueue work for a client it can see. It cannot read the queue.
CREATE POLICY jobs_insert ON jobs FOR INSERT
  WITH CHECK (
    client_id IN (SELECT visible_client_ids())
    AND uploaded_by = app_user_id()
    AND app_role() IN ('admin', 'accountant')
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON
  firms, clients, users, user_client_access, bank_accounts, files, statements,
  parser_profiles, bank_transactions, categories, rules, corrections, audit_log,
  processing_events, statement_extractions, statement_pages, saved_views
TO daftar_app, daftar_worker;

REVOKE ALL ON jobs FROM daftar_app, daftar_worker;
GRANT INSERT ON jobs TO daftar_app;
