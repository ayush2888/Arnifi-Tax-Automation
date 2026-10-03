-- Synthetic ledger seed for Al Noor Trading LLC (Stage A).

INSERT INTO accounting_periods (id, client_id, label, period_start, period_end, status) VALUES
  (
    'a0000001-0000-4000-8000-000000000001',
    '22222222-2222-4222-8222-222222222222',
    'Q1 2026',
    '2026-01-01',
    '2026-03-31',
    'OPEN'
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO chart_accounts (
  id, client_id, code, name, account_type, is_ar, is_ap, is_vat_control, is_bank, vat201_box
) VALUES
  ('a1000001-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', '1000', 'Bank', 'asset', false, false, false, true, NULL),
  ('a1000001-0000-4000-8000-000000000002', '22222222-2222-4222-8222-222222222222', '1100', 'Accounts receivable', 'asset', true, false, false, false, NULL),
  ('a1000001-0000-4000-8000-000000000003', '22222222-2222-4222-8222-222222222222', '1200', 'VAT recoverable (input)', 'asset', false, false, true, false, '9'),
  ('a1000001-0000-4000-8000-000000000004', '22222222-2222-4222-8222-222222222222', '2000', 'Accounts payable', 'liability', false, true, false, false, NULL),
  ('a1000001-0000-4000-8000-000000000005', '22222222-2222-4222-8222-222222222222', '2100', 'VAT payable (output)', 'liability', false, false, true, false, '1b'),
  ('a1000001-0000-4000-8000-000000000006', '22222222-2222-4222-8222-222222222222', '3000', 'Retained earnings', 'equity', false, false, false, false, NULL),
  ('a1000001-0000-4000-8000-000000000007', '22222222-2222-4222-8222-222222222222', '4000', 'Sales revenue', 'income', false, false, false, false, NULL),
  ('a1000001-0000-4000-8000-000000000008', '22222222-2222-4222-8222-222222222222', '5000', 'Operating expenses', 'expense', false, false, false, false, NULL)
ON CONFLICT (id) DO NOTHING;
