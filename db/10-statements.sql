-- Stage D2: year-end close audit (P&L → retained earnings).

CREATE TABLE year_end_closes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id),
  period_id uuid NOT NULL REFERENCES accounting_periods(id),
  journal_entry_id uuid NOT NULL REFERENCES journal_entries(id),
  net_income_minor bigint NOT NULL,
  actor_id uuid NOT NULL REFERENCES users(id),
  note text NOT NULL DEFAULT '',
  at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, period_id)
);

CREATE INDEX year_end_closes_period_idx ON year_end_closes (client_id, period_id);

ALTER TABLE year_end_closes ENABLE ROW LEVEL SECURITY;
ALTER TABLE year_end_closes FORCE ROW LEVEL SECURITY;

CREATE POLICY year_end_closes_read ON year_end_closes
  FOR SELECT USING (client_id IN (SELECT visible_client_ids()));
CREATE POLICY year_end_closes_insert ON year_end_closes
  FOR INSERT WITH CHECK (client_id IN (SELECT visible_client_ids()) AND app_role() IN ('admin', 'accountant'));
CREATE POLICY year_end_closes_update ON year_end_closes
  FOR UPDATE USING (client_id IN (SELECT visible_client_ids()) AND app_role() IN ('admin', 'accountant'))
  WITH CHECK (client_id IN (SELECT visible_client_ids()) AND app_role() IN ('admin', 'accountant'));
CREATE POLICY year_end_closes_delete ON year_end_closes
  FOR DELETE USING (client_id IN (SELECT visible_client_ids()) AND app_role() IN ('admin', 'accountant'));

GRANT SELECT, INSERT, UPDATE, DELETE ON year_end_closes TO daftar_app, daftar_worker;
