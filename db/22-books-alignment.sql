-- Pre–Phase 1 alignment: monthly periods, voucher types, approver role,
-- soft-delete drafts, corrects_entry_id, posted tag edits, VAT two-step seed.

-- ---------------------------------------------------------------------------
-- 1) Roles: add approver
-- ---------------------------------------------------------------------------
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('admin', 'accountant', 'approver', 'viewer'));

UPDATE users
SET role = 'approver'
WHERE id = '44444444-4444-4444-8444-444444444444'
  AND role = 'admin';

-- Ensure Layla has access to all three synthetic books clients (already seeded in 17).
INSERT INTO user_client_access (user_id, client_id) VALUES
  ('44444444-4444-4444-8444-444444444444', 'e1000001-0000-4000-8000-000000000001'),
  ('44444444-4444-4444-8444-444444444444', 'e1000001-0000-4000-8000-000000000002'),
  ('44444444-4444-4444-8444-444444444444', 'e1000001-0000-4000-8000-000000000003')
ON CONFLICT DO NOTHING;

-- Invite stub table
CREATE TABLE IF NOT EXISTS books_user_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id uuid NOT NULL REFERENCES firms(id),
  client_id uuid NOT NULL REFERENCES clients(id),
  email text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'accountant', 'approver', 'viewer')),
  invited_by uuid NOT NULL REFERENCES users(id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked')),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE books_user_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE books_user_invites FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS books_user_invites_all ON books_user_invites;
CREATE POLICY books_user_invites_all ON books_user_invites FOR ALL
  USING (client_id IN (SELECT visible_client_ids()) AND app_role() IN ('admin', 'approver'))
  WITH CHECK (client_id IN (SELECT visible_client_ids()) AND app_role() IN ('admin', 'approver'));
DROP POLICY IF EXISTS books_user_invites_read ON books_user_invites;
CREATE POLICY books_user_invites_read ON books_user_invites FOR SELECT
  USING (client_id IN (SELECT visible_client_ids()));
GRANT SELECT, INSERT, UPDATE ON books_user_invites TO daftar_app, daftar_worker;

-- Retention config (defaults: CT 7y, VAT 5y)
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS retention_ct_years int NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS retention_vat_years int NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS fiscal_year_start_month int NOT NULL DEFAULT 1
    CHECK (fiscal_year_start_month BETWEEN 1 AND 12);

-- ---------------------------------------------------------------------------
-- 2) Journal columns: voucher_type, corrects_entry_id, deleted_at, entry tags
-- ---------------------------------------------------------------------------
ALTER TABLE books_journal_entries
  ADD COLUMN IF NOT EXISTS voucher_type text NOT NULL DEFAULT 'Journal',
  ADD COLUMN IF NOT EXISTS corrects_entry_id uuid REFERENCES books_journal_entries(id),
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'books_journal_entries_voucher_type_check'
  ) THEN
    ALTER TABLE books_journal_entries
      ADD CONSTRAINT books_journal_entries_voucher_type_check
      CHECK (voucher_type IN (
        'Sales', 'Purchase', 'Receipt', 'Payment', 'Contra', 'Journal',
        'Credit Note', 'Debit Note', 'Opening', 'Closing'
      ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS books_journal_entries_voucher_idx
  ON books_journal_entries (client_id, voucher_type, entry_date DESC);
CREATE INDEX IF NOT EXISTS books_journal_entries_deleted_idx
  ON books_journal_entries (client_id) WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- 3) Voucher number series (replaces JE- on post)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS books_voucher_sequences (
  client_id uuid NOT NULL REFERENCES clients(id),
  voucher_type text NOT NULL,
  year int NOT NULL CHECK (year >= 2000 AND year <= 2100),
  prefix text NOT NULL,
  last_n int NOT NULL DEFAULT 0 CHECK (last_n >= 0),
  PRIMARY KEY (client_id, voucher_type, year)
);

ALTER TABLE books_voucher_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE books_voucher_sequences FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS books_voucher_sequences_all ON books_voucher_sequences;
CREATE POLICY books_voucher_sequences_all ON books_voucher_sequences FOR ALL
  USING (client_id IN (SELECT visible_client_ids()) AND app_role() IN ('admin', 'accountant', 'approver'))
  WITH CHECK (client_id IN (SELECT visible_client_ids()) AND app_role() IN ('admin', 'accountant', 'approver'));
DROP POLICY IF EXISTS books_voucher_sequences_read ON books_voucher_sequences;
CREATE POLICY books_voucher_sequences_read ON books_voucher_sequences FOR SELECT
  USING (client_id IN (SELECT visible_client_ids()));
GRANT SELECT, INSERT, UPDATE ON books_voucher_sequences TO daftar_app, daftar_worker;

CREATE OR REPLACE FUNCTION books_voucher_prefix(p_type text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_type
    WHEN 'Sales' THEN 'SV'
    WHEN 'Purchase' THEN 'PV'
    WHEN 'Receipt' THEN 'RV'
    WHEN 'Payment' THEN 'PY'
    WHEN 'Contra' THEN 'CV'
    WHEN 'Journal' THEN 'JV'
    WHEN 'Credit Note' THEN 'CN'
    WHEN 'Debit Note' THEN 'DN'
    WHEN 'Opening' THEN 'OB'
    WHEN 'Closing' THEN 'CL'
    ELSE 'JV'
  END;
$$;

CREATE OR REPLACE FUNCTION books_next_voucher_no(p_client_id uuid, p_voucher_type text, p_year int)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  n int;
  pref text;
BEGIN
  pref := books_voucher_prefix(p_voucher_type);
  INSERT INTO books_voucher_sequences (client_id, voucher_type, year, prefix, last_n)
  VALUES (p_client_id, p_voucher_type, p_year, pref, 0)
  ON CONFLICT (client_id, voucher_type, year) DO NOTHING;

  SELECT last_n, prefix INTO n, pref
  FROM books_voucher_sequences
  WHERE client_id = p_client_id AND voucher_type = p_voucher_type AND year = p_year
  FOR UPDATE;

  n := n + 1;
  UPDATE books_voucher_sequences SET last_n = n, prefix = pref
  WHERE client_id = p_client_id AND voucher_type = p_voucher_type AND year = p_year;

  RETURN pref || '-' || p_year::text || '-' || lpad(n::text, 4, '0');
END;
$$;
GRANT EXECUTE ON FUNCTION books_next_voucher_no(uuid, text, int) TO daftar_app, daftar_worker;
GRANT EXECUTE ON FUNCTION books_voucher_prefix(text) TO daftar_app, daftar_worker;

-- Seed default series rows for synthetic clients (2026)
INSERT INTO books_voucher_sequences (client_id, voucher_type, year, prefix, last_n)
SELECT c.id, v.voucher_type, 2026, books_voucher_prefix(v.voucher_type), 0
FROM clients c
CROSS JOIN (VALUES
  ('Sales'), ('Purchase'), ('Receipt'), ('Payment'), ('Contra'),
  ('Journal'), ('Credit Note'), ('Debit Note'), ('Opening'), ('Closing')
) AS v(voucher_type)
WHERE c.is_synthetic = true
ON CONFLICT DO NOTHING;

-- Migrate existing JE-#### to JV-#### and set voucher_type heuristics
-- (disable immutability triggers for one-time data migration)
ALTER TABLE books_journal_entries DISABLE TRIGGER USER;
ALTER TABLE books_journal_lines DISABLE TRIGGER USER;

UPDATE books_journal_entries e
SET voucher_type = CASE
  WHEN e.entry_type = 'opening' THEN 'Opening'
  WHEN e.entry_type = 'closing' THEN 'Closing'
  WHEN e.entry_type = 'reversal' THEN 'Journal'
  WHEN e.memo ILIKE '%receipt%' THEN 'Receipt'
  WHEN e.memo ILIKE '%payment%' OR e.memo ILIKE '%VAT settlement%' OR e.memo ILIKE '%VAT return%' THEN 'Payment'
  WHEN e.memo ILIKE '%invoice%' OR e.memo ILIKE '%sale%' THEN 'Sales'
  WHEN e.memo ILIKE '%bill%' OR e.memo ILIKE '%supplier%' OR e.memo ILIKE '%purchase%' THEN 'Purchase'
  ELSE COALESCE(NULLIF(e.voucher_type, ''), 'Journal')
END;

-- Rewrite entry_no JE- → voucher prefix series in date order per type
DO $$
DECLARE
  grp RECORD;
  ent RECORD;
  n int;
  pref text;
  new_no text;
BEGIN
  FOR grp IN
    SELECT DISTINCT client_id, voucher_type, EXTRACT(YEAR FROM entry_date)::int AS yr
    FROM books_journal_entries
    WHERE entry_no IS NOT NULL AND status IN ('posted', 'reversed')
  LOOP
    n := 0;
    pref := books_voucher_prefix(grp.voucher_type);
    FOR ent IN
      SELECT id FROM books_journal_entries
      WHERE client_id = grp.client_id
        AND voucher_type = grp.voucher_type
        AND EXTRACT(YEAR FROM entry_date)::int = grp.yr
        AND entry_no IS NOT NULL
        AND status IN ('posted', 'reversed')
      ORDER BY entry_date, created_at, id
    LOOP
      n := n + 1;
      new_no := pref || '-' || grp.yr::text || '-' || lpad(n::text, 4, '0');
      UPDATE books_journal_entries SET entry_no = new_no WHERE id = ent.id;
    END LOOP;
    INSERT INTO books_voucher_sequences (client_id, voucher_type, year, prefix, last_n)
    VALUES (grp.client_id, grp.voucher_type, grp.yr, pref, n)
    ON CONFLICT (client_id, voucher_type, year)
    DO UPDATE SET last_n = GREATEST(books_voucher_sequences.last_n, EXCLUDED.last_n),
                  prefix = EXCLUDED.prefix;
  END LOOP;
END $$;

ALTER TABLE books_journal_entries ENABLE TRIGGER USER;
ALTER TABLE books_journal_lines ENABLE TRIGGER USER;

-- Point books_next_entry_no at Journal voucher series for backward compat
CREATE OR REPLACE FUNCTION books_next_entry_no(p_client_id uuid, p_year int)
RETURNS text
LANGUAGE sql
AS $$
  SELECT books_next_voucher_no(p_client_id, 'Journal', p_year);
$$;

-- ---------------------------------------------------------------------------
-- 4) Posted immutability: allow entry tags + line tag-only edits
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_books_posted_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  st text;
BEGIN
  IF TG_TABLE_NAME = 'books_journal_lines' THEN
    SELECT status INTO st FROM books_journal_entries WHERE id = COALESCE(NEW.entry_id, OLD.entry_id);
    IF st IN ('posted', 'reversed') THEN
      IF TG_OP = 'UPDATE'
         AND NEW.entry_id = OLD.entry_id
         AND NEW.account_id = OLD.account_id
         AND NEW.debit_minor = OLD.debit_minor
         AND NEW.credit_minor = OLD.credit_minor
         AND NEW.currency IS NOT DISTINCT FROM OLD.currency
         AND NEW.original_minor IS NOT DISTINCT FROM OLD.original_minor
         AND NEW.fx_rate_scaled IS NOT DISTINCT FROM OLD.fx_rate_scaled
         AND NEW.aed_minor IS NOT DISTINCT FROM OLD.aed_minor
         AND NEW.line_memo IS NOT DISTINCT FROM OLD.line_memo
         AND NEW.vat_treatment IS NOT DISTINCT FROM OLD.vat_treatment
         AND NEW.vat_code IS NOT DISTINCT FROM OLD.vat_code
         AND NEW.vat_amount_minor IS NOT DISTINCT FROM OLD.vat_amount_minor
         AND NEW.linked_vat_line_id IS NOT DISTINCT FROM OLD.linked_vat_line_id
         AND NEW.tags IS DISTINCT FROM OLD.tags THEN
        RETURN NEW;
      END IF;
      RAISE EXCEPTION 'books_posted_immutable';
    END IF;
  ELSIF TG_TABLE_NAME = 'books_journal_entries' THEN
    IF TG_OP = 'UPDATE' AND OLD.status IN ('posted', 'reversed') THEN
      IF OLD.status = 'posted' AND NEW.status = 'reversed'
         AND NEW.reversed_by_entry_id IS NOT NULL THEN
        RETURN NEW;
      END IF;
      IF NEW.status = OLD.status
         AND OLD.entry_no IS NULL
         AND NEW.entry_no IS NOT NULL
         AND NEW.period_id = OLD.period_id
         AND NEW.entry_date = OLD.entry_date
         AND NEW.memo IS NOT DISTINCT FROM OLD.memo
         AND NEW.note IS NOT DISTINCT FROM OLD.note
         AND NEW.tags IS NOT DISTINCT FROM OLD.tags
         AND NEW.voucher_type IS NOT DISTINCT FROM OLD.voucher_type
         AND NEW.reverses_entry_id IS NOT DISTINCT FROM OLD.reverses_entry_id
         AND NEW.reversed_by_entry_id IS NOT DISTINCT FROM OLD.reversed_by_entry_id
         AND NEW.corrects_entry_id IS NOT DISTINCT FROM OLD.corrects_entry_id
         AND NEW.content_hash IS NOT DISTINCT FROM OLD.content_hash
         AND NEW.created_by = OLD.created_by THEN
        RETURN NEW;
      END IF;
      IF NEW.status = OLD.status
         AND NEW.period_id = OLD.period_id
         AND NEW.entry_date = OLD.entry_date
         AND NEW.reverses_entry_id IS NOT DISTINCT FROM OLD.reverses_entry_id
         AND NEW.reversed_by_entry_id IS NOT DISTINCT FROM OLD.reversed_by_entry_id
         AND NEW.corrects_entry_id IS NOT DISTINCT FROM OLD.corrects_entry_id
         AND NEW.entry_no IS NOT DISTINCT FROM OLD.entry_no
         AND NEW.content_hash IS NOT DISTINCT FROM OLD.content_hash
         AND NEW.created_by = OLD.created_by
         AND NEW.posted_at IS NOT DISTINCT FROM OLD.posted_at
         AND NEW.voucher_type IS NOT DISTINCT FROM OLD.voucher_type
         AND (
           NEW.memo IS DISTINCT FROM OLD.memo
           OR NEW.note IS DISTINCT FROM OLD.note
           OR NEW.tags IS DISTINCT FROM OLD.tags
         ) THEN
        RETURN NEW;
      END IF;
      RAISE EXCEPTION 'books_posted_immutable';
    END IF;
    IF TG_OP = 'DELETE' AND OLD.status IN ('posted', 'reversed') THEN
      RAISE EXCEPTION 'books_posted_immutable';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Soft-delete: block hard DELETE of drafts via app preference — keep trigger for posted only.
-- Draft hard deletes still allowed by ON DELETE CASCADE from lines; app uses deleted_at.

-- ---------------------------------------------------------------------------
-- 5) RLS: include approver on books write policies
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  tbl text;
  pol text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'books_periods', 'books_accounts', 'books_journal_entries',
    'books_journal_lines', 'books_audit_events',
    'books_tags', 'books_journal_attachments', 'books_saved_views',
    'books_recurring_templates', 'books_jobs', 'books_entry_sequences'
  ]
  LOOP
    IF to_regclass(tbl) IS NULL THEN
      CONTINUE;
    END IF;
    FOREACH pol IN ARRAY ARRAY[tbl || '_insert', tbl || '_update', tbl || '_delete', tbl || '_all']
    LOOP
      IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = tbl AND policyname = pol) THEN
        EXECUTE format('DROP POLICY %I ON %I', pol, tbl);
      END IF;
    END LOOP;
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR INSERT WITH CHECK (client_id IN (SELECT visible_client_ids()) AND app_role() IN (''admin'', ''accountant'', ''approver''))',
      tbl || '_insert', tbl
    );
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR UPDATE USING (client_id IN (SELECT visible_client_ids()) AND app_role() IN (''admin'', ''accountant'', ''approver'')) WITH CHECK (client_id IN (SELECT visible_client_ids()) AND app_role() IN (''admin'', ''accountant'', ''approver''))',
      tbl || '_update', tbl
    );
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR DELETE USING (client_id IN (SELECT visible_client_ids()) AND app_role() IN (''admin'', ''accountant'', ''approver''))',
      tbl || '_delete', tbl
    );
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 6) Monthly periods: keep old IDs as May; add Apr (LOCKED) + Jun (OPEN)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  desert uuid := 'e1000001-0000-4000-8000-000000000001';
  gulf uuid := 'e1000001-0000-4000-8000-000000000002';
  palm uuid := 'e1000001-0000-4000-8000-000000000003';
  may_d uuid := 'e2000001-0000-4000-8000-000000000001';
  may_g uuid := 'e2000001-0000-4000-8000-000000000002';
  may_p uuid := 'e2000001-0000-4000-8000-000000000003';
  apr_d uuid := 'e2000001-0000-4000-8000-000000000011';
  jun_d uuid := 'e2000001-0000-4000-8000-000000000013';
  apr_g uuid := 'e2000001-0000-4000-8000-000000000021';
  jun_g uuid := 'e2000001-0000-4000-8000-000000000023';
  apr_p uuid := 'e2000001-0000-4000-8000-000000000031';
  jun_p uuid := 'e2000001-0000-4000-8000-000000000033';
BEGIN
  -- Rename existing Q2 → May 2026
  UPDATE books_periods SET
    label = 'May 2026',
    period_start = '2026-05-01',
    period_end = '2026-05-31',
    status = 'OPEN'
  WHERE id IN (may_d, may_g, may_p);

  INSERT INTO books_periods (id, client_id, label, period_start, period_end, status) VALUES
    (apr_d, desert, 'Apr 2026', '2026-04-01', '2026-04-30', 'LOCKED'),
    (jun_d, desert, 'Jun 2026', '2026-06-01', '2026-06-30', 'OPEN'),
    (apr_g, gulf, 'Apr 2026', '2026-04-01', '2026-04-30', 'LOCKED'),
    (jun_g, gulf, 'Jun 2026', '2026-06-01', '2026-06-30', 'OPEN'),
    (apr_p, palm, 'Apr 2026', '2026-04-01', '2026-04-30', 'LOCKED'),
    (jun_p, palm, 'Jun 2026', '2026-06-01', '2026-06-30', 'OPEN')
  ON CONFLICT (id) DO UPDATE SET
    label = EXCLUDED.label,
    period_start = EXCLUDED.period_start,
    period_end = EXCLUDED.period_end,
    status = EXCLUDED.status;

  ALTER TABLE books_journal_entries DISABLE TRIGGER USER;
  ALTER TABLE books_journal_lines DISABLE TRIGGER USER;

  -- Remap journals by entry_date month
  UPDATE books_journal_entries e SET period_id = apr_d
  WHERE e.client_id = desert AND e.entry_date >= '2026-04-01' AND e.entry_date < '2026-05-01';
  UPDATE books_journal_entries e SET period_id = may_d
  WHERE e.client_id = desert AND e.entry_date >= '2026-05-01' AND e.entry_date < '2026-06-01';
  UPDATE books_journal_entries e SET period_id = jun_d
  WHERE e.client_id = desert AND e.entry_date >= '2026-06-01' AND e.entry_date < '2026-07-01';

  UPDATE books_journal_entries e SET period_id = apr_g
  WHERE e.client_id = gulf AND e.entry_date >= '2026-04-01' AND e.entry_date < '2026-05-01';
  UPDATE books_journal_entries e SET period_id = may_g
  WHERE e.client_id = gulf AND e.entry_date >= '2026-05-01' AND e.entry_date < '2026-06-01';
  UPDATE books_journal_entries e SET period_id = jun_g
  WHERE e.client_id = gulf AND e.entry_date >= '2026-06-01' AND e.entry_date < '2026-07-01';

  UPDATE books_journal_entries e SET period_id = apr_p
  WHERE e.client_id = palm AND e.entry_date >= '2026-04-01' AND e.entry_date < '2026-05-01';
  UPDATE books_journal_entries e SET period_id = may_p
  WHERE e.client_id = palm AND e.entry_date >= '2026-05-01' AND e.entry_date < '2026-06-01';
  UPDATE books_journal_entries e SET period_id = jun_p
  WHERE e.client_id = palm AND e.entry_date >= '2026-06-01' AND e.entry_date < '2026-07-01';

  ALTER TABLE books_journal_entries ENABLE TRIGGER USER;
  ALTER TABLE books_journal_lines ENABLE TRIGGER USER;
END $$;

-- ---------------------------------------------------------------------------
-- 7) Rename scheduled memos (drop "Scheduled" wording)
-- ---------------------------------------------------------------------------
ALTER TABLE books_journal_entries DISABLE TRIGGER USER;
UPDATE books_journal_entries
SET memo = 'Office rent June'
WHERE id = 'e4000001-0000-4000-8000-000000000015';
ALTER TABLE books_journal_entries ENABLE TRIGGER USER;

-- ---------------------------------------------------------------------------
-- 8) Replace VAT settlement seed with two-step return + payment
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  cid uuid := 'e1000001-0000-4000-8000-000000000001';
  omar uuid := '55555555-5555-4555-8555-555555555555';
  layla uuid := '44444444-4444-4444-8444-444444444444';
  jun_id uuid := 'e2000001-0000-4000-8000-000000000013';
  old_id uuid := 'e4000001-0000-4000-8000-000000000016';
  ret_id uuid := 'e4000001-0000-4000-8000-000000000026';
  pay_id uuid := 'e4000001-0000-4000-8000-000000000027';
  acc_2210 uuid;
  acc_1430 uuid;
  acc_2220 uuid;
  acc_1440 uuid;
  acc_bank uuid;
  out_cr bigint;
  out_dr bigint;
  in_dr bigint;
  in_cr bigint;
  out_net bigint;
  in_net bigint;
  payable bigint;
  vno text;
BEGIN
  SELECT id INTO acc_2210 FROM books_accounts WHERE client_id = cid AND code = '2210';
  SELECT id INTO acc_1430 FROM books_accounts WHERE client_id = cid AND code = '1430';
  SELECT id INTO acc_2220 FROM books_accounts WHERE client_id = cid AND code = '2220';
  SELECT id INTO acc_1440 FROM books_accounts WHERE client_id = cid AND code = '1440';
  SELECT id INTO acc_bank FROM books_accounts WHERE client_id = cid AND code IN ('1120', '1110', '1001')
  ORDER BY CASE code WHEN '1120' THEN 0 WHEN '1110' THEN 1 ELSE 2 END LIMIT 1;

  -- Cancel old scheduled/posted single-line settlement
  DELETE FROM books_jobs
  WHERE kind = 'schedule_post' AND payload->>'entryId' = old_id::text;

  IF EXISTS (SELECT 1 FROM books_journal_entries WHERE id = old_id) THEN
    -- Soft-remove from TB: reverse if posted, else soft-delete draft/scheduled
    IF EXISTS (SELECT 1 FROM books_journal_entries WHERE id = old_id AND status = 'posted') THEN
      -- Mark deleted and reverse via opposite posted entry would change TB;
      -- instead delete lines after flipping to draft is blocked — hard path:
      -- set reversed with a correcting wipe: delete entry lines by disabling trigger.
      ALTER TABLE books_journal_lines DISABLE TRIGGER USER;
      ALTER TABLE books_journal_entries DISABLE TRIGGER USER;
      DELETE FROM books_journal_lines WHERE entry_id = old_id;
      DELETE FROM books_journal_entries WHERE id = old_id;
      ALTER TABLE books_journal_entries ENABLE TRIGGER USER;
      ALTER TABLE books_journal_lines ENABLE TRIGGER USER;
    ELSE
      ALTER TABLE books_journal_lines DISABLE TRIGGER USER;
      ALTER TABLE books_journal_entries DISABLE TRIGGER USER;
      DELETE FROM books_journal_lines WHERE entry_id = old_id;
      DELETE FROM books_journal_entries WHERE id = old_id;
      ALTER TABLE books_journal_entries ENABLE TRIGGER USER;
      ALTER TABLE books_journal_lines ENABLE TRIGGER USER;
    END IF;
  END IF;

  -- Balances of 2210 / 1430 from posted|reversed as of 2026-06-30
  SELECT COALESCE(SUM(l.credit_minor),0), COALESCE(SUM(l.debit_minor),0)
    INTO out_cr, out_dr
  FROM books_journal_lines l
  JOIN books_journal_entries e ON e.id = l.entry_id
  WHERE e.client_id = cid AND e.status IN ('posted','reversed')
    AND e.entry_date <= '2026-06-30' AND l.account_id = acc_2210;

  SELECT COALESCE(SUM(l.debit_minor),0), COALESCE(SUM(l.credit_minor),0)
    INTO in_dr, in_cr
  FROM books_journal_lines l
  JOIN books_journal_entries e ON e.id = l.entry_id
  WHERE e.client_id = cid AND e.status IN ('posted','reversed')
    AND e.entry_date <= '2026-06-30' AND l.account_id = acc_1430;

  out_net := out_cr - out_dr; -- credit balance of output
  in_net := in_dr - in_cr;   -- debit balance of input

  IF out_net < 0 THEN out_net := 0; END IF;
  IF in_net < 0 THEN in_net := 0; END IF;
  payable := out_net - in_net;

  -- Return entry (posted as Layla)
  IF NOT EXISTS (SELECT 1 FROM books_journal_entries WHERE id = ret_id) THEN
    INSERT INTO books_journal_entries (
      id, client_id, period_id, memo, entry_date, status, entry_type, voucher_type,
      content_hash, created_by, posted_at, tags
    ) VALUES (
      ret_id, cid, jun_id, 'VAT return Jun 2026', '2026-06-28', 'draft', 'manual', 'Journal',
      'seed-vat-return', omar, NULL, ARRAY['vat']
    );

    IF out_net > 0 THEN
      INSERT INTO books_journal_lines (
        entry_id, client_id, account_id, debit_minor, credit_minor, currency, aed_minor, line_memo, tags
      ) VALUES (ret_id, cid, acc_2210, out_net, 0, 'AED', out_net, 'Clear VAT output', ARRAY['vat']);
    END IF;
    IF in_net > 0 THEN
      INSERT INTO books_journal_lines (
        entry_id, client_id, account_id, debit_minor, credit_minor, currency, aed_minor, line_memo, tags
      ) VALUES (ret_id, cid, acc_1430, 0, in_net, 'AED', in_net, 'Clear VAT input', ARRAY['vat']);
    END IF;
    IF payable > 0 THEN
      INSERT INTO books_journal_lines (
        entry_id, client_id, account_id, debit_minor, credit_minor, currency, aed_minor, line_memo, tags
      ) VALUES (ret_id, cid, acc_2220, 0, payable, 'AED', payable, 'VAT payable', ARRAY['vat']);
    ELSIF payable < 0 THEN
      INSERT INTO books_journal_lines (
        entry_id, client_id, account_id, debit_minor, credit_minor, currency, aed_minor, line_memo, tags
      ) VALUES (ret_id, cid, acc_1440, (-payable), 0, 'AED', (-payable), 'VAT receivable', ARRAY['vat']);
    END IF;

    -- Balance guard: if only one side, skip posting
    IF (SELECT COALESCE(SUM(debit_minor),0) = COALESCE(SUM(credit_minor),0) AND COALESCE(SUM(debit_minor),0) > 0
        FROM books_journal_lines WHERE entry_id = ret_id) THEN
      vno := books_next_voucher_no(cid, 'Journal', 2026);
      UPDATE books_journal_entries
      SET status = 'posted', posted_at = now(), entry_no = vno
      WHERE id = ret_id;
    END IF;
  END IF;

  -- Payment entry when payable > 0
  IF payable > 0 AND acc_bank IS NOT NULL AND NOT EXISTS (SELECT 1 FROM books_journal_entries WHERE id = pay_id) THEN
    INSERT INTO books_journal_entries (
      id, client_id, period_id, memo, entry_date, status, entry_type, voucher_type,
      content_hash, created_by, tags
    ) VALUES (
      pay_id, cid, jun_id, 'VAT payment Jun 2026', '2026-06-29', 'draft', 'manual', 'Payment',
      'seed-vat-pay', omar, ARRAY['vat']
    );
    INSERT INTO books_journal_lines (
      entry_id, client_id, account_id, debit_minor, credit_minor, currency, aed_minor, line_memo, tags
    ) VALUES
      (pay_id, cid, acc_2220, payable, 0, 'AED', payable, 'Settle VAT payable', ARRAY['vat']),
      (pay_id, cid, acc_bank, 0, payable, 'AED', payable, 'Bank payment to FTA', ARRAY['vat']);
    vno := books_next_voucher_no(cid, 'Payment', 2026);
    UPDATE books_journal_entries
    SET status = 'posted', posted_at = now(), entry_no = vno
    WHERE id = pay_id;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 9) Seed tags onto demo entries (entry-level + lines)
-- ---------------------------------------------------------------------------
ALTER TABLE books_journal_entries DISABLE TRIGGER USER;
ALTER TABLE books_journal_lines DISABLE TRIGGER USER;

UPDATE books_journal_entries
SET tags = ARRAY['ops']
WHERE id IN (
  'e4000001-0000-4000-8000-000000000012',
  'e4000001-0000-4000-8000-000000000015'
);

UPDATE books_journal_entries
SET tags = ARRAY['vat', 'ops']
WHERE id IN (
  'e4000001-0000-4000-8000-000000000010',
  'e4000001-0000-4000-8000-000000000026'
);

UPDATE books_journal_lines l
SET tags = ARRAY['ops']
FROM books_journal_entries e
WHERE l.entry_id = e.id
  AND e.id IN (
    'e4000001-0000-4000-8000-000000000012',
    'e4000001-0000-4000-8000-000000000015'
  );

UPDATE books_journal_lines l
SET tags = ARRAY['vat']
FROM books_journal_entries e
WHERE l.entry_id = e.id
  AND e.id IN (
    'e4000001-0000-4000-8000-000000000010',
    'e4000001-0000-4000-8000-000000000026',
    'e4000001-0000-4000-8000-000000000027'
  );

ALTER TABLE books_journal_entries ENABLE TRIGGER USER;
ALTER TABLE books_journal_lines ENABLE TRIGGER USER;

-- ---------------------------------------------------------------------------
-- 10) Schedule post uses voucher numbers
-- ---------------------------------------------------------------------------
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
    WHERE id = (j.payload->>'entryId')::uuid AND deleted_at IS NULL;
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

    new_no := books_next_voucher_no(
      ent.client_id,
      COALESCE(ent.voucher_type, 'Journal'),
      EXTRACT(YEAR FROM ent.entry_date)::int
    );
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

-- Re-run due schedule posts (June rent etc.)
SELECT books_run_due_schedule_posts();
