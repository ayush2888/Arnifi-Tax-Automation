-- Fix create-client: access_insert checked clients via RLS, but the new client is not
-- yet in visible_client_ids() (chicken-and-egg). Use SECURITY DEFINER helpers so the
-- WITH CHECK can see firm membership without granting broad clients_read.

CREATE OR REPLACE FUNCTION client_in_app_firm(p_client_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM clients c
    WHERE c.id = p_client_id
      AND c.firm_id = app_firm_id()
  );
$$;

CREATE OR REPLACE FUNCTION user_in_app_firm(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM users u
    WHERE u.id = p_user_id
      AND u.firm_id = app_firm_id()
  );
$$;

REVOKE ALL ON FUNCTION client_in_app_firm(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION user_in_app_firm(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION client_in_app_firm(uuid) TO daftar_app, daftar_worker;
GRANT EXECUTE ON FUNCTION user_in_app_firm(uuid) TO daftar_app, daftar_worker;

DROP POLICY IF EXISTS access_insert ON user_client_access;
CREATE POLICY access_insert ON user_client_access FOR INSERT
  WITH CHECK (
    app_role() IN ('admin', 'accountant')
    AND client_in_app_firm(client_id)
    AND user_in_app_firm(user_id)
  );
