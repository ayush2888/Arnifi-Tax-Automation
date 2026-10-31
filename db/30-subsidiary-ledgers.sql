-- Subsidiary ledgers: counterparties (customers, suppliers, lenders, shareholders) and a
-- nullable party tag on books journal lines. Sales, purchase, loan, advance and capital
-- ledgers are derived views over books_journal_lines grouped by party.

CREATE TABLE IF NOT EXISTS books_parties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id),
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  party_type text NOT NULL CHECK (party_type IN (
    'customer', 'supplier', 'lender', 'borrower', 'shareholder', 'employee', 'other'
  )),
  trn text,
  email text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS books_parties_client_name_type_uidx
  ON books_parties (client_id, lower(btrim(name)), party_type);
CREATE INDEX IF NOT EXISTS books_parties_client_idx ON books_parties (client_id, party_type, name);

ALTER TABLE books_journal_lines
  ADD COLUMN IF NOT EXISTS party_id uuid REFERENCES books_parties(id);

CREATE INDEX IF NOT EXISTS books_journal_lines_party_idx
  ON books_journal_lines (client_id, party_id, account_id)
  WHERE party_id IS NOT NULL;

ALTER TABLE books_parties ENABLE ROW LEVEL SECURITY;
ALTER TABLE books_parties FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS books_parties_read ON books_parties;
DROP POLICY IF EXISTS books_parties_insert ON books_parties;
DROP POLICY IF EXISTS books_parties_update ON books_parties;
DROP POLICY IF EXISTS books_parties_delete ON books_parties;

CREATE POLICY books_parties_read ON books_parties
  FOR SELECT USING (client_id IN (SELECT visible_client_ids()));
CREATE POLICY books_parties_insert ON books_parties
  FOR INSERT WITH CHECK (
    client_id IN (SELECT visible_client_ids()) AND app_role() IN ('admin', 'accountant')
  );
CREATE POLICY books_parties_update ON books_parties
  FOR UPDATE USING (
    client_id IN (SELECT visible_client_ids()) AND app_role() IN ('admin', 'accountant')
  ) WITH CHECK (
    client_id IN (SELECT visible_client_ids()) AND app_role() IN ('admin', 'accountant')
  );
CREATE POLICY books_parties_delete ON books_parties
  FOR DELETE USING (
    client_id IN (SELECT visible_client_ids()) AND app_role() IN ('admin', 'accountant')
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON books_parties TO daftar_app, daftar_worker;
