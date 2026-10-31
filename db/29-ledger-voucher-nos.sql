-- Ledger journal voucher numbers (Sales / Purchase / Journal series).
-- Used by invoice approve-post and the Journals screen (not books_* tables).

ALTER TABLE journal_entries
  ADD COLUMN IF NOT EXISTS entry_no text,
  ADD COLUMN IF NOT EXISTS voucher_type text NOT NULL DEFAULT 'Journal';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'journal_entries_voucher_type_check'
  ) THEN
    ALTER TABLE journal_entries
      ADD CONSTRAINT journal_entries_voucher_type_check
      CHECK (voucher_type IN (
        'Sales', 'Purchase', 'Receipt', 'Payment', 'Contra', 'Journal',
        'Credit Note', 'Debit Note', 'Opening', 'Closing'
      ));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS journal_entries_entry_no_uidx
  ON journal_entries (client_id, entry_no)
  WHERE entry_no IS NOT NULL;

CREATE TABLE IF NOT EXISTS ledger_voucher_sequences (
  client_id uuid NOT NULL REFERENCES clients(id),
  voucher_type text NOT NULL,
  year int NOT NULL,
  prefix text NOT NULL,
  last_n int NOT NULL DEFAULT 0,
  PRIMARY KEY (client_id, voucher_type, year)
);

ALTER TABLE ledger_voucher_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger_voucher_sequences FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ledger_voucher_sequences_all ON ledger_voucher_sequences;
CREATE POLICY ledger_voucher_sequences_all ON ledger_voucher_sequences FOR ALL
  USING (client_id IN (SELECT visible_client_ids()))
  WITH CHECK (client_id IN (SELECT visible_client_ids()));
DROP POLICY IF EXISTS ledger_voucher_sequences_read ON ledger_voucher_sequences;
CREATE POLICY ledger_voucher_sequences_read ON ledger_voucher_sequences FOR SELECT
  USING (client_id IN (SELECT visible_client_ids()));
GRANT SELECT, INSERT, UPDATE ON ledger_voucher_sequences TO daftar_app, daftar_worker;

CREATE OR REPLACE FUNCTION ledger_voucher_prefix(p_type text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_type
    WHEN 'Sales' THEN 'SI'
    WHEN 'Purchase' THEN 'PI'
    WHEN 'Receipt' THEN 'RV'
    WHEN 'Payment' THEN 'PV'
    WHEN 'Contra' THEN 'CV'
    WHEN 'Journal' THEN 'JV'
    WHEN 'Credit Note' THEN 'CN'
    WHEN 'Debit Note' THEN 'DN'
    WHEN 'Opening' THEN 'OB'
    WHEN 'Closing' THEN 'CL'
    ELSE 'JV'
  END;
$$;

CREATE OR REPLACE FUNCTION ledger_next_voucher_no(p_client_id uuid, p_voucher_type text, p_year int)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  n int;
  pref text;
BEGIN
  pref := ledger_voucher_prefix(p_voucher_type);
  INSERT INTO ledger_voucher_sequences (client_id, voucher_type, year, prefix, last_n)
  VALUES (p_client_id, p_voucher_type, p_year, pref, 0)
  ON CONFLICT (client_id, voucher_type, year) DO NOTHING;

  SELECT last_n, prefix INTO n, pref
  FROM ledger_voucher_sequences
  WHERE client_id = p_client_id AND voucher_type = p_voucher_type AND year = p_year
  FOR UPDATE;

  n := n + 1;
  UPDATE ledger_voucher_sequences SET last_n = n, prefix = pref
  WHERE client_id = p_client_id AND voucher_type = p_voucher_type AND year = p_year;

  RETURN pref || '-' || p_year::text || '-' || lpad(n::text, 4, '0');
END;
$$;

GRANT EXECUTE ON FUNCTION ledger_voucher_prefix(text) TO daftar_app, daftar_worker;
GRANT EXECUTE ON FUNCTION ledger_next_voucher_no(uuid, text, int) TO daftar_app, daftar_worker;

-- Backfill existing posted ledger entries (invoice-sourced → Sales/Purchase).
UPDATE journal_entries e
SET voucher_type = CASE d.doc_type
  WHEN 'SALES_INVOICE' THEN 'Sales'
  WHEN 'PURCHASE_INVOICE' THEN 'Purchase'
  WHEN 'CREDIT_NOTE' THEN 'Credit Note'
  ELSE COALESCE(NULLIF(e.voucher_type, ''), 'Journal')
END
FROM documents d
WHERE d.id = e.source_document_id
  AND e.entry_no IS NULL;

DO $$
DECLARE
  r record;
  vno text;
  yr int;
BEGIN
  FOR r IN
    SELECT id, client_id, voucher_type, entry_date
    FROM journal_entries
    WHERE entry_no IS NULL
    ORDER BY entry_date, created_at
  LOOP
    yr := EXTRACT(YEAR FROM r.entry_date)::int;
    vno := ledger_next_voucher_no(r.client_id, COALESCE(r.voucher_type, 'Journal'), yr);
    UPDATE journal_entries SET entry_no = vno WHERE id = r.id;
  END LOOP;
END $$;
