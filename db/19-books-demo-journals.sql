-- Phase 0 demo journals for screenshots / UX (≥10 rows on Desert Falcon).
-- Extra posted+reversed pairs net to zero on TB so golden A stays valid.
-- Gulf Crest + Palm Grove get opening balances from fixtures/books-goldens.

-- Allow scheduled status (UI chip); balance trigger still only checks posted.
ALTER TABLE books_journal_entries DROP CONSTRAINT IF EXISTS books_journal_entries_status_check;
ALTER TABLE books_journal_entries
  ADD CONSTRAINT books_journal_entries_status_check
  CHECK (status IN ('draft', 'posted', 'reversed', 'scheduled'));

CREATE OR REPLACE FUNCTION books_seed_post_entry(p_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  cid uuid;
  d date;
  y int;
BEGIN
  SELECT client_id, entry_date INTO cid, d
  FROM books_journal_entries WHERE id = p_id AND status = 'draft';
  IF cid IS NULL THEN RETURN; END IF;
  y := EXTRACT(YEAR FROM d)::int;
  UPDATE books_journal_entries
  SET status = 'posted',
      posted_at = COALESCE(posted_at, d::timestamptz),
      entry_no = COALESCE(entry_no, books_next_entry_no(cid, y))
  WHERE id = p_id AND status = 'draft';
END;
$$;

CREATE OR REPLACE FUNCTION books_seed_reverse_entry(p_id uuid, p_date date)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  orig books_journal_entries%ROWTYPE;
  rev_id uuid := gen_random_uuid();
  line record;
BEGIN
  SELECT * INTO orig FROM books_journal_entries WHERE id = p_id AND status = 'posted';
  IF orig.id IS NULL THEN RETURN NULL; END IF;

  INSERT INTO books_journal_entries (
    id, client_id, period_id, memo, entry_date, status, reverses_entry_id,
    entry_type, content_hash, created_by
  ) VALUES (
    rev_id, orig.client_id, orig.period_id,
    'Reversal of ' || COALESCE(orig.entry_no, orig.memo),
    p_date, 'draft', orig.id, 'reversal',
    'seed-rev-' || orig.id::text, orig.created_by
  );

  FOR line IN
    SELECT * FROM books_journal_lines WHERE entry_id = orig.id ORDER BY id
  LOOP
    INSERT INTO books_journal_lines (
      entry_id, client_id, account_id, debit_minor, credit_minor, currency,
      aed_minor, line_memo, vat_treatment, tags
    ) VALUES (
      rev_id, line.client_id, line.account_id,
      line.credit_minor, line.debit_minor, line.currency,
      line.aed_minor, 'Reversal: ' || line.line_memo, line.vat_treatment, line.tags
    );
  END LOOP;

  PERFORM books_seed_post_entry(rev_id);
  UPDATE books_journal_entries
  SET status = 'reversed', reversed_by_entry_id = rev_id
  WHERE id = orig.id;

  RETURN rev_id;
END;
$$;

-- Tag VAT on April invoice lines (posted) — disable immutability for seed-only metadata.
ALTER TABLE books_journal_lines DISABLE TRIGGER USER;
UPDATE books_journal_lines
SET vat_treatment = 'standard'
WHERE id IN (
  'e5000001-0000-4000-8000-000000000004',
  'e5000001-0000-4000-8000-000000000005'
)
AND vat_treatment IS NULL;
ALTER TABLE books_journal_lines ENABLE TRIGGER USER;

DO $$
DECLARE
  desert uuid := 'e1000001-0000-4000-8000-000000000001';
  gulf uuid := 'e1000001-0000-4000-8000-000000000002';
  palm uuid := 'e1000001-0000-4000-8000-000000000003';
  p_desert uuid := 'e2000001-0000-4000-8000-000000000001';
  p_gulf uuid := 'e2000001-0000-4000-8000-000000000002';
  p_palm uuid := 'e2000001-0000-4000-8000-000000000003';
  omar uuid := '55555555-5555-4555-8555-555555555555';
  acc_bank uuid;
  acc_ar uuid;
  acc_vat uuid;
  acc_rev uuid;
  acc_exp uuid;
  acc_rent uuid;
  acc_bank_chg uuid;
  acc_eq uuid;
  acc_inv uuid;
  eid uuid;
BEGIN
  -- Idempotent: skip if demo marker already present.
  IF EXISTS (
    SELECT 1 FROM books_journal_entries
    WHERE id = 'e4000001-0000-4000-8000-000000000010'
  ) THEN
    RETURN;
  END IF;

  SELECT id INTO acc_bank FROM books_accounts WHERE client_id = desert AND code = '1001';
  SELECT id INTO acc_ar FROM books_accounts WHERE client_id = desert AND code = '1101';
  SELECT id INTO acc_vat FROM books_accounts WHERE client_id = desert AND code = '2101';
  SELECT id INTO acc_rev FROM books_accounts WHERE client_id = desert AND code = '4001';
  SELECT id INTO acc_exp FROM books_accounts WHERE client_id = desert AND code = '5107';
  SELECT id INTO acc_rent FROM books_accounts WHERE client_id = desert AND code = '5102';
  SELECT id INTO acc_bank_chg FROM books_accounts WHERE client_id = desert AND code = '5104';
  SELECT id INTO acc_eq FROM books_accounts WHERE client_id = desert AND code = '3001';

  -- 4) May consulting invoice (VAT split) — posted
  eid := 'e4000001-0000-4000-8000-000000000010';
  INSERT INTO books_journal_entries (
    id, client_id, period_id, memo, entry_date, status, entry_type, content_hash, created_by
  ) VALUES (eid, desert, p_desert, 'May consulting invoice', '2026-05-05', 'draft', 'manual', 'seed-may', omar);
  INSERT INTO books_journal_lines (entry_id, client_id, account_id, debit_minor, credit_minor, currency, aed_minor, line_memo, vat_treatment) VALUES
    (eid, desert, acc_ar, 21000, 0, 'AED', 21000, 'AR', 'standard'),
    (eid, desert, acc_rev, 0, 20000, 'AED', 20000, 'Consulting', 'standard'),
    (eid, desert, acc_vat, 0, 1000, 'AED', 1000, 'VAT 5%', 'standard');
  PERFORM books_seed_post_entry(eid);

  -- 5) Bank charges — posted
  eid := 'e4000001-0000-4000-8000-000000000011';
  INSERT INTO books_journal_entries (
    id, client_id, period_id, memo, entry_date, status, entry_type, content_hash, created_by
  ) VALUES (eid, desert, p_desert, 'Bank charges', '2026-05-12', 'draft', 'auto', 'seed-bank-chg', omar);
  INSERT INTO books_journal_lines (entry_id, client_id, account_id, debit_minor, credit_minor, currency, aed_minor, line_memo) VALUES
    (eid, desert, acc_bank_chg, 150, 0, 'AED', 150, 'Fees'),
    (eid, desert, acc_bank, 0, 150, 'AED', 150, 'Bank');
  PERFORM books_seed_post_entry(eid);

  -- 6) Rent — posted
  eid := 'e4000001-0000-4000-8000-000000000012';
  INSERT INTO books_journal_entries (
    id, client_id, period_id, memo, entry_date, status, entry_type, content_hash, created_by
  ) VALUES (eid, desert, p_desert, 'Office rent May', '2026-05-01', 'draft', 'manual', 'seed-rent', omar);
  INSERT INTO books_journal_lines (entry_id, client_id, account_id, debit_minor, credit_minor, currency, aed_minor, line_memo) VALUES
    (eid, desert, acc_rent, 8000, 0, 'AED', 8000, 'Rent'),
    (eid, desert, acc_bank, 0, 8000, 'AED', 8000, 'Bank');
  PERFORM books_seed_post_entry(eid);

  -- 7) Mistaken duplicate sale — post then reverse (nets zero on TB beyond temporary)
  eid := 'e4000001-0000-4000-8000-000000000013';
  INSERT INTO books_journal_entries (
    id, client_id, period_id, memo, entry_date, status, entry_type, content_hash, created_by
  ) VALUES (eid, desert, p_desert, 'Duplicate sale (to reverse)', '2026-05-18', 'draft', 'manual', 'seed-dup', omar);
  INSERT INTO books_journal_lines (entry_id, client_id, account_id, debit_minor, credit_minor, currency, aed_minor, line_memo, vat_treatment) VALUES
    (eid, desert, acc_ar, 5250, 0, 'AED', 5250, 'AR', 'standard'),
    (eid, desert, acc_rev, 0, 5000, 'AED', 5000, 'Revenue', 'standard'),
    (eid, desert, acc_vat, 0, 250, 'AED', 250, 'VAT 5%', 'standard');
  PERFORM books_seed_post_entry(eid);
  PERFORM books_seed_reverse_entry(eid, '2026-05-19');

  -- 8) Another temporary accrual — reverse (nets zero)
  eid := 'e4000001-0000-4000-8000-000000000014';
  INSERT INTO books_journal_entries (
    id, client_id, period_id, memo, entry_date, status, entry_type, content_hash, created_by
  ) VALUES (eid, desert, p_desert, 'Temp accrual (to reverse)', '2026-05-20', 'draft', 'manual', 'seed-accr', omar);
  INSERT INTO books_journal_lines (entry_id, client_id, account_id, debit_minor, credit_minor, currency, aed_minor, line_memo) VALUES
    (eid, desert, acc_exp, 900, 0, 'AED', 900, 'Accrual'),
    (eid, desert, acc_bank, 0, 900, 'AED', 900, 'Clearing');
  PERFORM books_seed_post_entry(eid);
  PERFORM books_seed_reverse_entry(eid, '2026-05-21');

  -- 9) Scheduled rent June
  eid := 'e4000001-0000-4000-8000-000000000015';
  INSERT INTO books_journal_entries (
    id, client_id, period_id, memo, entry_date, status, entry_type, content_hash, created_by
  ) VALUES (eid, desert, p_desert, 'Scheduled rent June', '2026-06-01', 'scheduled', 'manual', 'seed-sched-rent', omar);
  INSERT INTO books_journal_lines (entry_id, client_id, account_id, debit_minor, credit_minor, currency, aed_minor, line_memo) VALUES
    (eid, desert, acc_rent, 8000, 0, 'AED', 8000, 'Rent'),
    (eid, desert, acc_bank, 0, 8000, 'AED', 8000, 'Bank');

  -- 10) Scheduled VAT return accrual
  eid := 'e4000001-0000-4000-8000-000000000016';
  INSERT INTO books_journal_entries (
    id, client_id, period_id, memo, entry_date, status, entry_type, content_hash, created_by
  ) VALUES (eid, desert, p_desert, 'Scheduled VAT settlement', '2026-06-28', 'scheduled', 'manual', 'seed-sched-vat', omar);
  INSERT INTO books_journal_lines (entry_id, client_id, account_id, debit_minor, credit_minor, currency, aed_minor, line_memo, vat_treatment) VALUES
    (eid, desert, acc_vat, 1500, 0, 'AED', 1500, 'Clear output', 'standard'),
    (eid, desert, acc_bank, 0, 1500, 'AED', 1500, 'FTA payment', NULL);

  -- 11) Draft pending review
  eid := 'e4000001-0000-4000-8000-000000000017';
  INSERT INTO books_journal_entries (
    id, client_id, period_id, memo, entry_date, status, entry_type, content_hash, created_by, note
  ) VALUES (eid, desert, p_desert, 'Draft - supplier bill review', '2026-05-25', 'draft', 'manual', 'seed-draft', omar, 'Awaiting tax invoice');
  -- Lines rewritten in db/21 with Input VAT 1430 split (acc_exp net + VAT).
  INSERT INTO books_journal_lines (entry_id, client_id, account_id, debit_minor, credit_minor, currency, aed_minor, line_memo, vat_treatment) VALUES
    (eid, desert, acc_exp, 3000, 0, 'AED', 3000, 'Office supplies', NULL),
    (eid, desert, acc_bank, 0, 3150, 'AED', 3150, 'Bank', NULL);

  -- 12) Cash receipt (posted)
  eid := 'e4000001-0000-4000-8000-000000000018';
  INSERT INTO books_journal_entries (
    id, client_id, period_id, memo, entry_date, status, entry_type, content_hash, created_by
  ) VALUES (eid, desert, p_desert, 'Customer receipt', '2026-05-28', 'draft', 'auto', 'seed-receipt', omar);
  INSERT INTO books_journal_lines (entry_id, client_id, account_id, debit_minor, credit_minor, currency, aed_minor, line_memo) VALUES
    (eid, desert, acc_bank, 10500, 0, 'AED', 10500, 'Receipt'),
    (eid, desert, acc_ar, 0, 10500, 'AED', 10500, 'Clear AR');
  PERFORM books_seed_post_entry(eid);

  -- Gulf Crest opening (from golden B input) — posted
  SELECT id INTO acc_bank FROM books_accounts WHERE client_id = gulf AND code = '1001';
  SELECT id INTO acc_inv FROM books_accounts WHERE client_id = gulf AND code = '1300';
  SELECT id INTO acc_eq FROM books_accounts WHERE client_id = gulf AND code = '3001';
  eid := 'e4000002-0000-4000-8000-000000000001';
  INSERT INTO books_journal_entries (
    id, client_id, period_id, memo, entry_date, status, entry_type, content_hash, created_by
  ) VALUES (eid, gulf, p_gulf, 'Opening balances', '2026-04-01', 'draft', 'opening', 'seed-gulf-ob', omar);
  INSERT INTO books_journal_lines (entry_id, client_id, account_id, debit_minor, credit_minor, currency, aed_minor, line_memo) VALUES
    (eid, gulf, acc_bank, 250000, 0, 'AED', 250000, 'Opening bank'),
    (eid, gulf, acc_inv, 80000, 0, 'AED', 80000, 'Opening inventory'),
    (eid, gulf, acc_eq, 0, 330000, 'AED', 330000, 'Opening equity');
  PERFORM books_seed_post_entry(eid);

  -- Palm Grove opening (from golden C input) — posted
  SELECT id INTO acc_bank FROM books_accounts WHERE client_id = palm AND code = '1001';
  SELECT id INTO acc_inv FROM books_accounts WHERE client_id = palm AND code = '1501';
  SELECT id INTO acc_eq FROM books_accounts WHERE client_id = palm AND code = '3001';
  eid := 'e4000003-0000-4000-8000-000000000001';
  INSERT INTO books_journal_entries (
    id, client_id, period_id, memo, entry_date, status, entry_type, content_hash, created_by
  ) VALUES (eid, palm, p_palm, 'Opening balances', '2026-04-01', 'draft', 'opening', 'seed-palm-ob', omar);
  INSERT INTO books_journal_lines (entry_id, client_id, account_id, debit_minor, credit_minor, currency, aed_minor, line_memo) VALUES
    (eid, palm, acc_bank, 500000, 0, 'AED', 500000, 'Opening bank'),
    (eid, palm, acc_inv, 1200000, 0, 'AED', 1200000, 'Property at cost'),
    (eid, palm, acc_eq, 0, 1700000, 'AED', 1700000, 'Opening equity');
  PERFORM books_seed_post_entry(eid);
END $$;

GRANT EXECUTE ON FUNCTION books_seed_post_entry(uuid) TO daftar_app, daftar_worker;
GRANT EXECUTE ON FUNCTION books_seed_reverse_entry(uuid, date) TO daftar_app, daftar_worker;
