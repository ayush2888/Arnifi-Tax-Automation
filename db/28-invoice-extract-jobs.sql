-- Sales / purchase invoice extraction runs in the worker via books_jobs.
-- payload: { "documentId": uuid, "actorUserId": uuid }

ALTER TABLE books_jobs DROP CONSTRAINT IF EXISTS books_jobs_kind_check;
ALTER TABLE books_jobs
  ADD CONSTRAINT books_jobs_kind_check
  CHECK (kind IN ('schedule_post', 'recurring_materialize', 'auto_reverse', 'invoice_extract'));

CREATE INDEX IF NOT EXISTS books_jobs_document_idx
  ON books_jobs ((payload->>'documentId'))
  WHERE kind = 'invoice_extract';

CREATE INDEX IF NOT EXISTS documents_file_idx
  ON documents (client_id, file_id)
  WHERE file_id IS NOT NULL;

-- Dual control: the approver (not the preparer) posts invoices and releases packs, so
-- approvers need insert/update on those tables. Delete stays admin/accountant only.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['journal_entries', 'journal_lines', 'open_items', 'parties', 'documents', 'document_extractions', 'release_packs', 'pack_approvals'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_insert', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR INSERT WITH CHECK (client_id IN (SELECT visible_client_ids()) AND app_role() IN (''admin'', ''accountant'', ''approver''))',
      t || '_insert', t
    );
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_update', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR UPDATE USING (client_id IN (SELECT visible_client_ids()) AND app_role() IN (''admin'', ''accountant'', ''approver'')) WITH CHECK (client_id IN (SELECT visible_client_ids()) AND app_role() IN (''admin'', ''accountant'', ''approver''))',
      t || '_update', t
    );
  END LOOP;
END $$;

DROP POLICY IF EXISTS audit_insert ON audit_log;
CREATE POLICY audit_insert ON audit_log FOR INSERT WITH CHECK (
  firm_id = app_firm_id()
  AND app_role() IN ('admin', 'accountant', 'approver')
  AND (client_id IS NULL OR client_id IN (SELECT visible_client_ids()))
);

-- Approvers in the firm can see every synthetic company so they can approve postings.
INSERT INTO user_client_access (user_id, client_id)
SELECT u.id, c.id
FROM users u
JOIN clients c ON c.firm_id = u.firm_id
WHERE u.role = 'approver' AND c.is_synthetic AND c.archived_at IS NULL
ON CONFLICT DO NOTHING;
