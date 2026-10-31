-- Empty lab client for real-document extraction tests (scripts/lab/* only).
-- Always archived so it never appears in the accountant company switcher.
-- No journals seeded. Jun / Jul / Aug 2026 periods only.
-- is_synthetic = true so local FAIL security gate still allows the tenant.

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

INSERT INTO clients (id, firm_id, name, trn, default_currency, is_synthetic, archived_at) VALUES
  (
    'c1000001-0000-4000-8000-00000000a001',
    '11111111-1111-4111-8111-111111111111',
    'Alpha Ctrl',
    NULL,
    'AED',
    true,
    now()
  )
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name,
    is_synthetic = true,
    archived_at = COALESCE(clients.archived_at, now());

INSERT INTO user_client_access (user_id, client_id) VALUES
  ('55555555-5555-4555-8555-555555555555', 'c1000001-0000-4000-8000-00000000a001'),
  ('44444444-4444-4444-8444-444444444444', 'c1000001-0000-4000-8000-00000000a001')
ON CONFLICT DO NOTHING;

INSERT INTO accounting_periods (id, client_id, label, period_start, period_end, status) VALUES
  (
    'c1000001-0000-4000-8000-00000000a101',
    'c1000001-0000-4000-8000-00000000a001',
    'Jun 2026',
    '2026-06-01',
    '2026-06-30',
    'OPEN'
  ),
  (
    'c1000001-0000-4000-8000-00000000a102',
    'c1000001-0000-4000-8000-00000000a001',
    'Jul 2026',
    '2026-07-01',
    '2026-07-31',
    'OPEN'
  ),
  (
    'c1000001-0000-4000-8000-00000000a103',
    'c1000001-0000-4000-8000-00000000a001',
    'Aug 2026',
    '2026-08-01',
    '2026-08-31',
    'OPEN'
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO chart_accounts (
  id, client_id, code, name, account_type, is_ar, is_ap, is_vat_control, is_bank, vat201_box
) VALUES
  ('c1000001-0000-4000-8000-00000000b001', 'c1000001-0000-4000-8000-00000000a001', '1000', 'Bank', 'asset', false, false, false, true, NULL),
  ('c1000001-0000-4000-8000-00000000b002', 'c1000001-0000-4000-8000-00000000a001', '1100', 'Accounts receivable', 'asset', true, false, false, false, NULL),
  ('c1000001-0000-4000-8000-00000000b003', 'c1000001-0000-4000-8000-00000000a001', '1200', 'VAT recoverable (input)', 'asset', false, false, true, false, '9'),
  ('c1000001-0000-4000-8000-00000000b004', 'c1000001-0000-4000-8000-00000000a001', '2000', 'Accounts payable', 'liability', false, true, false, false, NULL),
  ('c1000001-0000-4000-8000-00000000b005', 'c1000001-0000-4000-8000-00000000a001', '2100', 'VAT payable (output)', 'liability', false, false, true, false, '1b'),
  ('c1000001-0000-4000-8000-00000000b006', 'c1000001-0000-4000-8000-00000000a001', '3000', 'Retained earnings', 'equity', false, false, false, false, NULL),
  ('c1000001-0000-4000-8000-00000000b007', 'c1000001-0000-4000-8000-00000000a001', '4000', 'Sales revenue', 'income', false, false, false, false, NULL),
  ('c1000001-0000-4000-8000-00000000b008', 'c1000001-0000-4000-8000-00000000a001', '5000', 'Operating expenses', 'expense', false, false, false, false, NULL)
ON CONFLICT (id) DO NOTHING;

-- Placeholder bank *account* (empty). Not a statement — needed so uploads have a target.
INSERT INTO bank_accounts (id, client_id, bank_name, label, iban_masked, currency) VALUES
  (
    'c1000001-0000-4000-8000-00000000c001',
    'c1000001-0000-4000-8000-00000000a001',
    'Alpha Ctrl',
    'Operating account',
    'AE** **** **** LAB1',
    'AED'
  )
ON CONFLICT (id) DO UPDATE
SET bank_name = EXCLUDED.bank_name,
    label = EXCLUDED.label;
