-- Extra COA lines for accruals / FA (Al Noor demo client).

INSERT INTO chart_accounts (
  id, client_id, code, name, account_type, is_ar, is_ap, is_vat_control, is_bank, vat201_box
) VALUES
  ('a1000001-0000-4000-8000-000000000009', '22222222-2222-4222-8222-222222222222', '1300', 'Prepaid expenses', 'asset', false, false, false, false, NULL),
  ('a1000001-0000-4000-8000-000000000010', '22222222-2222-4222-8222-222222222222', '1500', 'Fixed assets', 'asset', false, false, false, false, NULL),
  ('a1000001-0000-4000-8000-000000000011', '22222222-2222-4222-8222-222222222222', '1510', 'Accumulated depreciation', 'asset', false, false, false, false, NULL),
  ('a1000001-0000-4000-8000-000000000012', '22222222-2222-4222-8222-222222222222', '2200', 'Accrued expenses', 'liability', false, false, false, false, NULL),
  ('a1000001-0000-4000-8000-000000000013', '22222222-2222-4222-8222-222222222222', '5100', 'Depreciation expense', 'expense', false, false, false, false, NULL)
ON CONFLICT (id) DO NOTHING;
