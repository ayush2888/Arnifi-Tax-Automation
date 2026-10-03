-- Phase 0 approval fixes: refs, blocked status, schedule jobs, VAT seed, 1210 default VAT.

ALTER TABLE books_journal_entries DROP CONSTRAINT IF EXISTS books_journal_entries_status_check;
ALTER TABLE books_journal_entries
  ADD CONSTRAINT books_journal_entries_status_check
  CHECK (status IN ('draft', 'posted', 'reversed', 'scheduled', 'blocked'));

CREATE TABLE IF NOT EXISTS books_ref_sequences (
  client_id uuid NOT NULL REFERENCES clients(id),
  kind text NOT NULL CHECK (kind IN ('DRAFT', 'SCH')),
  last_value int NOT NULL DEFAULT 0,
  PRIMARY KEY (client_id, kind)
);
GRANT SELECT, INSERT, UPDATE ON books_ref_sequences TO daftar_app, daftar_worker;

CREATE OR REPLACE FUNCTION books_next_display_ref(p_client_id uuid, p_kind text)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  n int;
BEGIN
  IF p_kind NOT IN ('DRAFT', 'SCH') THEN
    RAISE EXCEPTION 'books_ref_bad_kind';
  END IF;
  INSERT INTO books_ref_sequences (client_id, kind, last_value)
  VALUES (p_client_id, p_kind, 1)
  ON CONFLICT (client_id, kind) DO UPDATE
    SET last_value = books_ref_sequences.last_value + 1
  RETURNING last_value INTO n;
  RETURN p_kind || '-' || lpad(n::text, 4, '0');
END;
$$;
GRANT EXECUTE ON FUNCTION books_next_display_ref(uuid, text) TO daftar_app, daftar_worker;

-- Receivables are not VAT-coded by default.
UPDATE books_coa_template SET default_vat_code = NULL WHERE code = '1210';
UPDATE books_accounts SET default_vat_code = NULL WHERE code = '1210';

-- Ensure every account has statement_line from template when missing.
UPDATE books_accounts a
SET statement_line = t.statement_line
FROM books_coa_template t
WHERE a.code = t.code
  AND (a.statement_line IS NULL OR a.statement_line = '');

-- TAX chip source: only VAT control accounts keep vat_treatment on lines.
ALTER TABLE books_journal_lines DISABLE TRIGGER USER;
UPDATE books_journal_lines l
SET vat_treatment = NULL
FROM books_accounts a
WHERE a.id = l.account_id
  AND a.code NOT IN ('1430', '2210', '2101')
  AND l.vat_treatment IS NOT NULL;

UPDATE books_journal_lines l
SET vat_treatment = 'standard'
FROM books_accounts a
WHERE a.id = l.account_id
  AND a.code IN ('1430', '2210', '2101')
  AND l.debit_minor + l.credit_minor > 0;
ALTER TABLE books_journal_lines ENABLE TRIGGER USER;

-- Fix posted Office expense (6600) to include Input VAT 1430 (net 2000 + VAT 100).
DO $$
DECLARE
  eid uuid := 'e4000001-0000-4000-8000-000000000003';
  cid uuid := 'e1000001-0000-4000-8000-000000000001';
  vat_in uuid;
  bank uuid;
BEGIN
  SELECT id INTO vat_in FROM books_accounts WHERE client_id = cid AND code = '1430';
  SELECT id INTO bank FROM books_accounts WHERE client_id = cid AND code = '1120';
  IF vat_in IS NULL OR bank IS NULL THEN
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM books_journal_entries WHERE id = eid) THEN
    RETURN;
  END IF;
  -- Skip if already fixed.
  IF EXISTS (
    SELECT 1 FROM books_journal_lines l
    JOIN books_accounts a ON a.id = l.account_id
    WHERE l.entry_id = eid AND a.code = '1430'
  ) THEN
    RETURN;
  END IF;

  ALTER TABLE books_journal_lines DISABLE TRIGGER USER;
  UPDATE books_journal_lines
  SET credit_minor = 2100, aed_minor = 2100, vat_treatment = NULL
  WHERE entry_id = eid AND account_id = bank AND credit_minor > 0;
  UPDATE books_journal_lines l
  SET vat_treatment = NULL
  FROM books_accounts a
  WHERE l.entry_id = eid AND a.id = l.account_id AND a.code = '6600';
  INSERT INTO books_journal_lines (
    entry_id, client_id, account_id, debit_minor, credit_minor, currency, aed_minor, line_memo, vat_treatment
  ) VALUES (eid, cid, vat_in, 100, 0, 'AED', 100, 'Input VAT 5%', 'standard');
  ALTER TABLE books_journal_lines ENABLE TRIGGER USER;
END $$;

-- Fix draft supplier bill: net expense + Input VAT (not combined taxable expense).
DO $$
DECLARE
  eid uuid := 'e4000001-0000-4000-8000-000000000017';
  cid uuid := 'e1000001-0000-4000-8000-000000000001';
  vat_in uuid;
  exp uuid;
  bank uuid;
BEGIN
  SELECT id INTO vat_in FROM books_accounts WHERE client_id = cid AND code = '1430';
  SELECT id INTO exp FROM books_accounts WHERE client_id = cid AND code = '6600';
  SELECT id INTO bank FROM books_accounts WHERE client_id = cid AND code = '1120';
  IF vat_in IS NULL OR exp IS NULL OR bank IS NULL THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM books_journal_entries WHERE id = eid AND status = 'draft') THEN RETURN; END IF;

  DELETE FROM books_journal_lines WHERE entry_id = eid;
  INSERT INTO books_journal_lines (
    entry_id, client_id, account_id, debit_minor, credit_minor, currency, aed_minor, line_memo, vat_treatment
  ) VALUES
    (eid, cid, exp, 3000, 0, 'AED', 3000, 'Office supplies', NULL),
    (eid, cid, vat_in, 150, 0, 'AED', 150, 'Input VAT 5%', 'standard'),
    (eid, cid, bank, 0, 3150, 'AED', 3150, 'Bank', NULL);

  UPDATE books_journal_entries
  SET memo = 'Draft - supplier bill review',
      reference = COALESCE(NULLIF(reference, ''), books_next_display_ref(cid, 'DRAFT')),
      note = 'Awaiting tax invoice'
  WHERE id = eid;
END $$;

-- Scheduled entries: manual type for VAT settlement; ASCII memos; refs; scheduled_for; jobs.
UPDATE books_journal_entries
SET entry_type = 'manual',
    memo = 'Scheduled VAT settlement',
    scheduled_for = entry_date,
    reference = COALESCE(NULLIF(reference, ''), books_next_display_ref(client_id, 'SCH'))
WHERE id = 'e4000001-0000-4000-8000-000000000016';

UPDATE books_journal_entries
SET memo = 'Scheduled rent June',
    scheduled_for = entry_date,
    reference = COALESCE(NULLIF(reference, ''), books_next_display_ref(client_id, 'SCH'))
WHERE id = 'e4000001-0000-4000-8000-000000000015';

INSERT INTO books_jobs (client_id, kind, status, payload, run_at)
SELECT e.client_id, 'schedule_post', 'queued',
       jsonb_build_object('entryId', e.id::text, 'actorUserId', e.created_by::text),
       COALESCE(e.scheduled_for, e.entry_date)::timestamptz
FROM books_journal_entries e
WHERE e.id IN (
  'e4000001-0000-4000-8000-000000000015',
  'e4000001-0000-4000-8000-000000000016'
)
AND NOT EXISTS (
  SELECT 1 FROM books_jobs j
  WHERE j.kind = 'schedule_post'
    AND j.payload->>'entryId' = e.id::text
);

-- Post due scheduled entries (date <= today) unless period locked → blocked.
CREATE OR REPLACE FUNCTION books_run_due_schedule_posts()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  j books_jobs;
  ent books_journal_entries%ROWTYPE;
  per books_periods%ROWTYPE;
  n int := 0;
  new_no text;
BEGIN
  LOOP
    SELECT * INTO j FROM books_jobs
    WHERE status = 'queued' AND kind = 'schedule_post' AND run_at <= now()
    ORDER BY run_at
    FOR UPDATE SKIP LOCKED
    LIMIT 1;
    EXIT WHEN j.id IS NULL;

    UPDATE books_jobs SET status = 'running' WHERE id = j.id;

    SELECT * INTO ent FROM books_journal_entries
    WHERE id = (j.payload->>'entryId')::uuid;
    IF ent.id IS NULL OR ent.status NOT IN ('scheduled', 'draft') THEN
      UPDATE books_jobs SET status = 'done', finished_at = now() WHERE id = j.id;
      CONTINUE;
    END IF;

    SELECT * INTO per FROM books_periods WHERE id = ent.period_id;
    IF per.status = 'LOCKED' THEN
      UPDATE books_journal_entries SET status = 'blocked' WHERE id = ent.id;
      UPDATE books_jobs
      SET status = 'done', finished_at = now(), error = 'period_locked'
      WHERE id = j.id;
      n := n + 1;
      CONTINUE;
    END IF;

    new_no := books_next_entry_no(ent.client_id, EXTRACT(YEAR FROM ent.entry_date)::int);
    UPDATE books_journal_entries
    SET status = 'posted',
        posted_at = now(),
        entry_no = COALESCE(books_journal_entries.entry_no, new_no)
    WHERE id = ent.id AND status IN ('scheduled', 'draft');

    UPDATE books_jobs SET status = 'done', finished_at = now(), error = NULL WHERE id = j.id;
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;
GRANT EXECUTE ON FUNCTION books_run_due_schedule_posts() TO daftar_app, daftar_worker;

SELECT books_run_due_schedule_posts();
