-- Stage G1 seed: profiles, source accounts, global posting rules (synthetic only).

INSERT INTO client_profile (
  client_id, legal_name, trn, base_currency, fy_start_month,
  vat_registered, vat_period, ct_applicable, ibans_json
) VALUES
  (
    '22222222-2222-4222-8222-222222222222',
    'Al Noor Trading LLC',
    '100000000000003',
    'AED',
    1,
    true,
    'quarterly',
    true,
    '[{"masked":"AE** **** **** 0001","label":"Operating"},{"masked":"AE** **** **** 0003","label":"Collections"}]'::jsonb
  ),
  (
    '33333333-3333-4333-8333-333333333333',
    'Harbour Cafe LLC',
    NULL,
    'AED',
    1,
    true,
    'quarterly',
    false,
    '[{"masked":"AE** **** **** 0002","label":"Operating"}]'::jsonb
  )
ON CONFLICT (client_id) DO UPDATE SET
  legal_name = EXCLUDED.legal_name,
  updated_at = now();

-- Ensure Suspense / clearing / fee accounts exist on Al Noor COA.
INSERT INTO chart_accounts (
  id, client_id, code, name, account_type, is_ar, is_ap, is_vat_control, is_bank, vat201_box
)
SELECT v.id, v.client_id, v.code, v.name, v.account_type, v.is_ar, v.is_ap, v.is_vat_control, v.is_bank, v.vat201_box
FROM (
  VALUES
    ('a1000001-0000-4000-8000-000000000010'::uuid, '22222222-2222-4222-8222-222222222222'::uuid, '1190', 'Suspense', 'asset', false, false, false, false, NULL::text),
    ('a1000001-0000-4000-8000-000000000011'::uuid, '22222222-2222-4222-8222-222222222222'::uuid, '1300', 'Disbursements clearing', 'asset', false, false, false, false, NULL::text),
    ('a1000001-0000-4000-8000-000000000012'::uuid, '22222222-2222-4222-8222-222222222222'::uuid, '1310', 'Gateway clearing', 'asset', false, false, false, false, NULL::text),
    ('a1000001-0000-4000-8000-000000000013'::uuid, '22222222-2222-4222-8222-222222222222'::uuid, '2200', 'Credit card payable', 'liability', false, false, false, false, NULL::text),
    ('a1000001-0000-4000-8000-000000000014'::uuid, '22222222-2222-4222-8222-222222222222'::uuid, '5100', 'Payment gateway fees', 'expense', false, false, false, false, NULL::text),
    ('a1000001-0000-4000-8000-000000000015'::uuid, '22222222-2222-4222-8222-222222222222'::uuid, '1400', 'Inventory', 'asset', false, false, false, false, NULL::text)
) AS v(id, client_id, code, name, account_type, is_ar, is_ap, is_vat_control, is_bank, vat201_box)
WHERE NOT EXISTS (
  SELECT 1 FROM chart_accounts c WHERE c.client_id = v.client_id AND c.code = v.code
)
AND NOT EXISTS (
  SELECT 1 FROM chart_accounts c WHERE c.id = v.id
);

INSERT INTO client_source_account (
  id, client_id, kind, label, currency, coa_account_id, bank_account_id, external_ref, active
) VALUES
  (
    'b1000001-0000-4000-8000-000000000001',
    '22222222-2222-4222-8222-222222222222',
    'bank',
    'Northwind Operating AED',
    'AED',
    'a1000001-0000-4000-8000-000000000001',
    '77777777-7777-4777-8777-777777777777',
    'AE**0001',
    true
  ),
  (
    'b1000001-0000-4000-8000-000000000002',
    '22222222-2222-4222-8222-222222222222',
    'bank',
    'Oasis Collections AED',
    'AED',
    'a1000001-0000-4000-8000-000000000001',
    '99999999-9999-4999-8999-999999999999',
    'AE**0003',
    true
  ),
  (
    'b1000001-0000-4000-8000-000000000003',
    '33333333-3333-4333-8333-333333333333',
    'bank',
    'Harbour Operating AED',
    'AED',
    NULL,
    '88888888-8888-4888-8888-888888888888',
    'AE**0002',
    true
  )
ON CONFLICT (id) DO NOTHING;

-- Firm-scoped global default posting rules (clients can override with client_id set).
INSERT INTO client_posting_rule (
  id, firm_id, client_id, doc_type, vendor_pattern, narration_regex, item_pattern,
  line_flag, vat_treatment, target_account_code, priority, defer_months, active
) VALUES
  (
    'c2000001-0000-4000-8000-000000000001',
    '11111111-1111-4111-8111-111111111111',
    NULL,
    'SALES_INVOICE',
    NULL,
    NULL,
    NULL,
    'revenue',
    'standard',
    '4000',
    900,
    0,
    true
  ),
  (
    'c2000001-0000-4000-8000-000000000002',
    '11111111-1111-4111-8111-111111111111',
    NULL,
    'SALES_INVOICE',
    NULL,
    NULL,
    'disbursement|gov(ernment)? fee|ministry',
    'disbursement',
    'none',
    '1300',
    100,
    0,
    true
  ),
  (
    'c2000001-0000-4000-8000-000000000003',
    '11111111-1111-4111-8111-111111111111',
    NULL,
    'PURCHASE_INVOICE',
    NULL,
    NULL,
    NULL,
    'expense',
    'standard',
    '5000',
    900,
    0,
    true
  ),
  (
    'c2000001-0000-4000-8000-000000000004',
    '11111111-1111-4111-8111-111111111111',
    NULL,
    'PURCHASE_INVOICE',
    NULL,
    NULL,
    'inventory|stock|goods',
    'asset',
    'standard',
    '1400',
    100,
    0,
    true
  ),
  (
    'c2000001-0000-4000-8000-000000000005',
    '11111111-1111-4111-8111-111111111111',
    NULL,
    NULL,
    NULL,
    'STRIPE|FEE|PAYOUT',
    NULL,
    'expense',
    'none',
    '5100',
    200,
    0,
    true
  ),
  (
    'c2000001-0000-4000-8000-000000000006',
    '11111111-1111-4111-8111-111111111111',
    NULL,
    NULL,
    NULL,
    'RENT|LEASE',
    NULL,
    'expense',
    'standard',
    '5000',
    150,
    0,
    true
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO period_pipeline_status (client_id, period_id, stage, counts_json, blockers_json)
VALUES (
  '22222222-2222-4222-8222-222222222222',
  'a0000001-0000-4000-8000-000000000001',
  'DOCS_COLLECTING',
  '{"docs":0,"proposed":0,"unmatched":0}'::jsonb,
  '[]'::jsonb
)
ON CONFLICT (client_id, period_id) DO NOTHING;
