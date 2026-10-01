-- Upgrade a database created before parser profiles were keyed by file type and header fingerprint.
-- Fresh installs already have these columns from 01-schema.sql.

ALTER TABLE parser_profiles ADD COLUMN IF NOT EXISTS file_type text;
ALTER TABLE parser_profiles ADD COLUMN IF NOT EXISTS header_fingerprint text;

UPDATE parser_profiles SET file_type = 'csv' WHERE file_type IS NULL;
UPDATE parser_profiles SET header_fingerprint = '' WHERE header_fingerprint IS NULL;

ALTER TABLE parser_profiles ALTER COLUMN file_type SET NOT NULL;
ALTER TABLE parser_profiles ALTER COLUMN header_fingerprint SET NOT NULL;

DO $$
BEGIN
  ALTER TABLE parser_profiles
    ADD CONSTRAINT parser_profiles_bank_type_headers_version
    UNIQUE (firm_id, bank_name, file_type, header_fingerprint, version);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'firms', 'clients', 'users', 'user_client_access', 'bank_accounts', 'files',
    'statements', 'parser_profiles', 'categories', 'rules', 'bank_transactions',
    'corrections', 'audit_log', 'processing_events', 'statement_extractions',
    'statement_pages', 'saved_views', 'jobs'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl);
  END LOOP;
END
$$;
