-- General client onboarding: accountants can create synthetic clients and seed months.
-- New clients are always is_synthetic = true (mark-real stays admin + security PASS).

DROP POLICY IF EXISTS clients_insert ON clients;
CREATE POLICY clients_insert ON clients FOR INSERT
  WITH CHECK (
    firm_id = app_firm_id()
    AND app_role() IN ('admin', 'accountant')
    AND is_synthetic = true
  );

DROP POLICY IF EXISTS clients_update ON clients;
CREATE POLICY clients_update ON clients FOR UPDATE
  USING (id IN (SELECT visible_client_ids()) AND app_role() IN ('admin', 'accountant'))
  WITH CHECK (
    id IN (SELECT visible_client_ids())
    AND app_role() IN ('admin', 'accountant')
    AND firm_id = app_firm_id()
  );

DROP POLICY IF EXISTS access_insert ON user_client_access;
CREATE POLICY access_insert ON user_client_access FOR INSERT
  WITH CHECK (
    app_role() IN ('admin', 'accountant')
    AND EXISTS (
      SELECT 1 FROM clients c
      WHERE c.id = client_id AND c.firm_id = app_firm_id()
    )
    AND EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = user_id AND u.firm_id = app_firm_id()
    )
  );

DROP POLICY IF EXISTS bank_accounts_insert ON bank_accounts;
CREATE POLICY bank_accounts_insert ON bank_accounts FOR INSERT
  WITH CHECK (
    client_id IN (SELECT visible_client_ids())
    AND app_role() IN ('admin', 'accountant')
  );

DROP POLICY IF EXISTS bank_accounts_update ON bank_accounts;
CREATE POLICY bank_accounts_update ON bank_accounts FOR UPDATE
  USING (client_id IN (SELECT visible_client_ids()) AND app_role() IN ('admin', 'accountant'))
  WITH CHECK (client_id IN (SELECT visible_client_ids()) AND app_role() IN ('admin', 'accountant'));
