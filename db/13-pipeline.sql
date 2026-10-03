-- Stage G1: client-agnostic books pipeline config, inbox, and period status.

-- Firm uploads may exist before client routing.
ALTER TABLE files ADD COLUMN IF NOT EXISTS firm_id uuid REFERENCES firms(id);
UPDATE files f
SET firm_id = c.firm_id
FROM clients c
WHERE f.client_id = c.id AND f.firm_id IS NULL;

ALTER TABLE files ALTER COLUMN client_id DROP NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'files_client_id_sha256_key'
  ) THEN
    ALTER TABLE files DROP CONSTRAINT files_client_id_sha256_key;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS files_firm_sha256_uidx
  ON files (firm_id, sha256)
  WHERE firm_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS files_client_sha256_uidx
  ON files (client_id, sha256)
  WHERE client_id IS NOT NULL;

CREATE TABLE client_profile (
  client_id uuid PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
  legal_name text NOT NULL,
  trn text,
  base_currency char(3) NOT NULL DEFAULT 'AED',
  fy_start_month int NOT NULL DEFAULT 1 CHECK (fy_start_month BETWEEN 1 AND 12),
  vat_registered boolean NOT NULL DEFAULT true,
  vat_period text NOT NULL DEFAULT 'quarterly'
    CHECK (vat_period IN ('monthly', 'quarterly')),
  ct_applicable boolean NOT NULL DEFAULT true,
  ibans_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE client_source_account (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('bank', 'card', 'gateway', 'other')),
  label text NOT NULL,
  currency char(3) NOT NULL DEFAULT 'AED',
  coa_account_id uuid REFERENCES chart_accounts(id),
  bank_account_id uuid REFERENCES bank_accounts(id),
  external_ref text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX client_source_account_client_idx ON client_source_account (client_id, kind);

CREATE TABLE client_posting_rule (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id uuid REFERENCES firms(id),
  client_id uuid REFERENCES clients(id) ON DELETE CASCADE,
  doc_type text,
  vendor_pattern text,
  narration_regex text,
  item_pattern text,
  line_flag text NOT NULL DEFAULT 'expense'
    CHECK (line_flag IN ('revenue', 'disbursement', 'expense', 'asset')),
  vat_treatment text NOT NULL DEFAULT 'standard'
    CHECK (vat_treatment IN ('standard', 'zero', 'exempt', 'out_of_scope', 'none')),
  target_account_code text,
  target_account_id uuid REFERENCES chart_accounts(id),
  priority int NOT NULL DEFAULT 100,
  defer_months int NOT NULL DEFAULT 0 CHECK (defer_months >= 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (client_id IS NOT NULL OR firm_id IS NOT NULL)
);

CREATE INDEX client_posting_rule_lookup_idx
  ON client_posting_rule (client_id, priority)
  WHERE active;

CREATE TABLE fx_rate (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  rate_date date NOT NULL,
  currency char(3) NOT NULL,
  -- AED per 1 unit of currency, scaled by 1e8 (integer minor-style; no floats).
  rate_to_aed_scaled bigint NOT NULL CHECK (rate_to_aed_scaled > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, rate_date, currency)
);

CREATE TABLE period_pipeline_status (
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  period_id uuid NOT NULL REFERENCES accounting_periods(id) ON DELETE CASCADE,
  stage text NOT NULL DEFAULT 'DOCS_COLLECTING' CHECK (stage IN (
    'DOCS_COLLECTING', 'EXTRACTED', 'JOURNALS_PROPOSED', 'JOURNALS_POSTED',
    'RECONCILED', 'CLOSE_CHECKS', 'TB_BALANCED', 'STATEMENTS_READY', 'PACKS_RELEASED'
  )),
  counts_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  blockers_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  assignee_user_id uuid REFERENCES users(id),
  provisional_opening boolean NOT NULL DEFAULT false,
  last_run_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, period_id)
);

CREATE TABLE document_inbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id uuid NOT NULL REFERENCES firms(id),
  file_id uuid NOT NULL REFERENCES files(id),
  routing_status text NOT NULL DEFAULT 'pending'
    CHECK (routing_status IN ('pending', 'routed', 'rejected')),
  detected_client_id uuid REFERENCES clients(id),
  detected_period_id uuid REFERENCES accounting_periods(id),
  routed_document_id uuid REFERENCES documents(id),
  routing_confidence int NOT NULL DEFAULT 0 CHECK (routing_confidence BETWEEN 0 AND 100),
  detected_doc_type text,
  duplicate_of uuid REFERENCES document_inbox(id),
  ocr_used boolean NOT NULL DEFAULT false,
  extraction_confidence int NOT NULL DEFAULT 0 CHECK (extraction_confidence BETWEEN 0 AND 100),
  error_json jsonb,
  uploaded_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX document_inbox_firm_pending_idx
  ON document_inbox (firm_id, routing_status, created_at DESC);

-- Widen documents.doc_type and add routing/OCR metadata.
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_doc_type_check;
ALTER TABLE documents ADD CONSTRAINT documents_doc_type_check CHECK (doc_type IN (
  'SALES_INVOICE', 'PURCHASE_INVOICE', 'CREDIT_NOTE', 'BANK_STATEMENT',
  'CARD_STATEMENT', 'GATEWAY_CSV', 'GATEWAY_PDF', 'OPENING_TB', 'PRIOR_FS', 'OTHER'
));

ALTER TABLE documents ADD COLUMN IF NOT EXISTS detected_client_id uuid REFERENCES clients(id);
ALTER TABLE documents ADD COLUMN IF NOT EXISTS routing_confidence int NOT NULL DEFAULT 100
  CHECK (routing_confidence BETWEEN 0 AND 100);
ALTER TABLE documents ADD COLUMN IF NOT EXISTS duplicate_of uuid REFERENCES documents(id);
ALTER TABLE documents ADD COLUMN IF NOT EXISTS ocr_used boolean NOT NULL DEFAULT false;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS extraction_confidence int NOT NULL DEFAULT 100
  CHECK (extraction_confidence BETWEEN 0 AND 100);
ALTER TABLE documents ADD COLUMN IF NOT EXISTS source_account_id uuid REFERENCES client_source_account(id);

-- FX fields on journal lines (AED amounts remain debit_minor/credit_minor).
ALTER TABLE journal_lines ADD COLUMN IF NOT EXISTS original_currency char(3);
ALTER TABLE journal_lines ADD COLUMN IF NOT EXISTS original_minor bigint;
ALTER TABLE journal_lines ADD COLUMN IF NOT EXISTS fx_rate_scaled bigint;
ALTER TABLE journal_lines ADD COLUMN IF NOT EXISTS aed_minor bigint;

CREATE TABLE journal_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id),
  period_id uuid NOT NULL REFERENCES accounting_periods(id),
  source_document_id uuid REFERENCES documents(id),
  source_inbox_id uuid REFERENCES document_inbox(id),
  journal_entry_id uuid REFERENCES journal_entries(id),
  status text NOT NULL DEFAULT 'PROPOSED'
    CHECK (status IN ('PROPOSED', 'APPROVED', 'REJECTED', 'POSTED')),
  confidence int NOT NULL DEFAULT 0 CHECK (confidence BETWEEN 0 AND 100),
  memo text NOT NULL DEFAULT '',
  entry_date date NOT NULL,
  source_span_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  suggested_rule_id uuid REFERENCES client_posting_rule(id),
  warnings_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE journal_proposal_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id uuid NOT NULL REFERENCES journal_proposals(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES clients(id),
  account_id uuid NOT NULL REFERENCES chart_accounts(id),
  debit_minor bigint NOT NULL DEFAULT 0 CHECK (debit_minor >= 0),
  credit_minor bigint NOT NULL DEFAULT 0 CHECK (credit_minor >= 0),
  currency char(3) NOT NULL DEFAULT 'AED',
  vat201_box text,
  line_memo text NOT NULL DEFAULT '',
  original_currency char(3),
  original_minor bigint,
  fx_rate_scaled bigint,
  aed_minor bigint,
  CHECK (NOT (debit_minor > 0 AND credit_minor > 0)),
  CHECK (debit_minor > 0 OR credit_minor > 0)
);

CREATE INDEX journal_proposals_period_idx
  ON journal_proposals (client_id, period_id, status, created_at DESC);

ALTER TABLE client_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_source_account ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_posting_rule ENABLE ROW LEVEL SECURITY;
ALTER TABLE fx_rate ENABLE ROW LEVEL SECURITY;
ALTER TABLE period_pipeline_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_inbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_proposal_lines ENABLE ROW LEVEL SECURITY;

ALTER TABLE client_profile FORCE ROW LEVEL SECURITY;
ALTER TABLE client_source_account FORCE ROW LEVEL SECURITY;
ALTER TABLE client_posting_rule FORCE ROW LEVEL SECURITY;
ALTER TABLE fx_rate FORCE ROW LEVEL SECURITY;
ALTER TABLE period_pipeline_status FORCE ROW LEVEL SECURITY;
ALTER TABLE document_inbox FORCE ROW LEVEL SECURITY;
ALTER TABLE journal_proposals FORCE ROW LEVEL SECURITY;
ALTER TABLE journal_proposal_lines FORCE ROW LEVEL SECURITY;

CREATE POLICY client_profile_read ON client_profile FOR SELECT
  USING (client_id IN (SELECT visible_client_ids()));
CREATE POLICY client_profile_write ON client_profile FOR ALL
  USING (client_id IN (SELECT visible_client_ids()) AND app_role() IN ('admin', 'accountant'))
  WITH CHECK (client_id IN (SELECT visible_client_ids()) AND app_role() IN ('admin', 'accountant'));

CREATE POLICY client_source_account_read ON client_source_account FOR SELECT
  USING (client_id IN (SELECT visible_client_ids()));
CREATE POLICY client_source_account_write ON client_source_account FOR ALL
  USING (client_id IN (SELECT visible_client_ids()) AND app_role() IN ('admin', 'accountant'))
  WITH CHECK (client_id IN (SELECT visible_client_ids()) AND app_role() IN ('admin', 'accountant'));

CREATE POLICY client_posting_rule_read ON client_posting_rule FOR SELECT
  USING (
    (client_id IS NOT NULL AND client_id IN (SELECT visible_client_ids()))
    OR (client_id IS NULL AND firm_id = app_firm_id())
  );
CREATE POLICY client_posting_rule_write ON client_posting_rule FOR ALL
  USING (
    app_role() IN ('admin', 'accountant')
    AND (
      (client_id IS NOT NULL AND client_id IN (SELECT visible_client_ids()))
      OR (client_id IS NULL AND firm_id = app_firm_id())
    )
  )
  WITH CHECK (
    app_role() IN ('admin', 'accountant')
    AND (
      (client_id IS NOT NULL AND client_id IN (SELECT visible_client_ids()))
      OR (client_id IS NULL AND firm_id = app_firm_id())
    )
  );

CREATE POLICY fx_rate_read ON fx_rate FOR SELECT
  USING (client_id IN (SELECT visible_client_ids()));
CREATE POLICY fx_rate_write ON fx_rate FOR ALL
  USING (client_id IN (SELECT visible_client_ids()) AND app_role() IN ('admin', 'accountant'))
  WITH CHECK (client_id IN (SELECT visible_client_ids()) AND app_role() IN ('admin', 'accountant'));

CREATE POLICY period_pipeline_status_read ON period_pipeline_status FOR SELECT
  USING (client_id IN (SELECT visible_client_ids()));
CREATE POLICY period_pipeline_status_write ON period_pipeline_status FOR ALL
  USING (client_id IN (SELECT visible_client_ids()) AND app_role() IN ('admin', 'accountant'))
  WITH CHECK (client_id IN (SELECT visible_client_ids()) AND app_role() IN ('admin', 'accountant'));

-- Unassigned inbox: viewers only see rows already detected for their clients.
-- Truly unassigned (NULL detected_client_id) is accountant/admin firm work.
CREATE POLICY document_inbox_read ON document_inbox FOR SELECT
  USING (
    firm_id = app_firm_id()
    AND (
      (detected_client_id IS NOT NULL AND detected_client_id IN (SELECT visible_client_ids()))
      OR (detected_client_id IS NULL AND app_role() IN ('admin', 'accountant'))
    )
  );
CREATE POLICY document_inbox_write ON document_inbox FOR ALL
  USING (firm_id = app_firm_id() AND app_role() IN ('admin', 'accountant'))
  WITH CHECK (firm_id = app_firm_id() AND app_role() IN ('admin', 'accountant'));

CREATE POLICY journal_proposals_read ON journal_proposals FOR SELECT
  USING (client_id IN (SELECT visible_client_ids()));
CREATE POLICY journal_proposals_write ON journal_proposals FOR ALL
  USING (client_id IN (SELECT visible_client_ids()) AND app_role() IN ('admin', 'accountant'))
  WITH CHECK (client_id IN (SELECT visible_client_ids()) AND app_role() IN ('admin', 'accountant'));

CREATE POLICY journal_proposal_lines_read ON journal_proposal_lines FOR SELECT
  USING (client_id IN (SELECT visible_client_ids()));
CREATE POLICY journal_proposal_lines_write ON journal_proposal_lines FOR ALL
  USING (client_id IN (SELECT visible_client_ids()) AND app_role() IN ('admin', 'accountant'))
  WITH CHECK (client_id IN (SELECT visible_client_ids()) AND app_role() IN ('admin', 'accountant'));

GRANT SELECT, INSERT, UPDATE, DELETE ON
  client_profile, client_source_account, client_posting_rule, fx_rate,
  period_pipeline_status, document_inbox, journal_proposals, journal_proposal_lines
TO daftar_app, daftar_worker;

-- Firm-level uploads: allow files rows with NULL client_id when firm_id matches.
DROP POLICY IF EXISTS files_read ON files;
DROP POLICY IF EXISTS files_insert ON files;
DROP POLICY IF EXISTS files_update ON files;
DROP POLICY IF EXISTS files_delete ON files;

CREATE POLICY files_read ON files FOR SELECT USING (
  (client_id IS NOT NULL AND client_id IN (SELECT visible_client_ids()))
  OR (client_id IS NULL AND firm_id = app_firm_id())
);
CREATE POLICY files_insert ON files FOR INSERT WITH CHECK (
  app_role() IN ('admin', 'accountant')
  AND (
    (client_id IS NOT NULL AND client_id IN (SELECT visible_client_ids()))
    OR (client_id IS NULL AND firm_id = app_firm_id())
  )
);
CREATE POLICY files_update ON files FOR UPDATE
  USING (
    app_role() IN ('admin', 'accountant')
    AND (
      (client_id IS NOT NULL AND client_id IN (SELECT visible_client_ids()))
      OR (client_id IS NULL AND firm_id = app_firm_id())
    )
  )
  WITH CHECK (
    app_role() IN ('admin', 'accountant')
    AND (
      (client_id IS NOT NULL AND client_id IN (SELECT visible_client_ids()))
      OR (client_id IS NULL AND firm_id = app_firm_id())
      OR (client_id IN (SELECT visible_client_ids()))
    )
  );
CREATE POLICY files_delete ON files FOR DELETE USING (
  app_role() IN ('admin', 'accountant')
  AND (
    (client_id IS NOT NULL AND client_id IN (SELECT visible_client_ids()))
    OR (client_id IS NULL AND firm_id = app_firm_id())
  )
);
