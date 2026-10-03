-- Stage E: corporate tax adjustments trail (computation report off the ledger).

CREATE TABLE ct_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id),
  period_id uuid NOT NULL REFERENCES accounting_periods(id),
  direction text NOT NULL CHECK (direction IN ('ADD_BACK', 'DEDUCT')),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  reason text NOT NULL,
  source_ref text NOT NULL DEFAULT '',
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ct_adjustments_period_idx ON ct_adjustments (client_id, period_id, created_at);

ALTER TABLE ct_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE ct_adjustments FORCE ROW LEVEL SECURITY;

CREATE POLICY ct_adjustments_read ON ct_adjustments
  FOR SELECT USING (client_id IN (SELECT visible_client_ids()));
CREATE POLICY ct_adjustments_insert ON ct_adjustments
  FOR INSERT WITH CHECK (client_id IN (SELECT visible_client_ids()) AND app_role() IN ('admin', 'accountant'));
CREATE POLICY ct_adjustments_update ON ct_adjustments
  FOR UPDATE USING (client_id IN (SELECT visible_client_ids()) AND app_role() IN ('admin', 'accountant'))
  WITH CHECK (client_id IN (SELECT visible_client_ids()) AND app_role() IN ('admin', 'accountant'));
CREATE POLICY ct_adjustments_delete ON ct_adjustments
  FOR DELETE USING (client_id IN (SELECT visible_client_ids()) AND app_role() IN ('admin', 'accountant'));

GRANT SELECT, INSERT, UPDATE, DELETE ON ct_adjustments TO daftar_app, daftar_worker;
