-- Stage G6: three synthetic pipeline demo clients (service / trading / real-estate).

INSERT INTO clients (id, firm_id, name, trn, default_currency, is_synthetic) VALUES
  ('d1000001-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Sandstorm Services LLC', '100000000000101', 'AED', true),
  ('d1000001-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'Caravan Trading LLC', '100000000000102', 'AED', true),
  ('d1000001-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'Palm Realty LLC', '100000000000103', 'AED', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO user_client_access (user_id, client_id) VALUES
  ('55555555-5555-4555-8555-555555555555', 'd1000001-0000-4000-8000-000000000001'),
  ('55555555-5555-4555-8555-555555555555', 'd1000001-0000-4000-8000-000000000002'),
  ('55555555-5555-4555-8555-555555555555', 'd1000001-0000-4000-8000-000000000003'),
  ('44444444-4444-4444-8444-444444444444', 'd1000001-0000-4000-8000-000000000001'),
  ('44444444-4444-4444-8444-444444444444', 'd1000001-0000-4000-8000-000000000002'),
  ('44444444-4444-4444-8444-444444444444', 'd1000001-0000-4000-8000-000000000003')
ON CONFLICT DO NOTHING;

INSERT INTO client_profile (
  client_id, legal_name, trn, base_currency, fy_start_month, vat_registered, vat_period, ct_applicable, ibans_json
) VALUES
  ('d1000001-0000-4000-8000-000000000001', 'Sandstorm Services LLC', '100000000000101', 'AED', 1, true, 'monthly', true,
   '[{"masked":"AE** **** **** 0101","label":"AED Ops"},{"masked":"AE** **** **** 0102","label":"USD Ops"}]'::jsonb),
  ('d1000001-0000-4000-8000-000000000002', 'Caravan Trading LLC', '100000000000102', 'AED', 1, true, 'monthly', true,
   '[{"masked":"AE** **** **** 0201","label":"Trading"}]'::jsonb),
  ('d1000001-0000-4000-8000-000000000003', 'Palm Realty LLC', '100000000000103', 'AED', 1, true, 'quarterly', true,
   '[{"masked":"AE** **** **** 0301","label":"Rental"}]'::jsonb)
ON CONFLICT (client_id) DO NOTHING;

INSERT INTO accounting_periods (id, client_id, label, period_start, period_end, status) VALUES
  ('d2000001-0000-4000-8000-000000000001', 'd1000001-0000-4000-8000-000000000001', '2026-01', '2026-01-01', '2026-01-31', 'OPEN'),
  ('d2000001-0000-4000-8000-000000000002', 'd1000001-0000-4000-8000-000000000002', '2026-01', '2026-01-01', '2026-01-31', 'OPEN'),
  ('d2000001-0000-4000-8000-000000000003', 'd1000001-0000-4000-8000-000000000003', 'Q1 2026', '2026-01-01', '2026-03-31', 'OPEN')
ON CONFLICT (id) DO NOTHING;

-- Minimal COA clone for each demo client (codes aligned with Al Noor helpers).
INSERT INTO chart_accounts (id, client_id, code, name, account_type, is_ar, is_ap, is_vat_control, is_bank, vat201_box)
SELECT gen_random_uuid(), c.id, a.code, a.name, a.account_type, a.is_ar, a.is_ap, a.is_vat_control, a.is_bank, a.vat201_box
FROM (VALUES
  ('d1000001-0000-4000-8000-000000000001'::uuid),
  ('d1000001-0000-4000-8000-000000000002'::uuid),
  ('d1000001-0000-4000-8000-000000000003'::uuid)
) AS c(id)
CROSS JOIN (
  SELECT code, name, account_type, is_ar, is_ap, is_vat_control, is_bank, vat201_box
  FROM chart_accounts
  WHERE client_id = '22222222-2222-4222-8222-222222222222'
) a
WHERE NOT EXISTS (
  SELECT 1 FROM chart_accounts x WHERE x.client_id = c.id AND x.code = a.code
);

INSERT INTO period_pipeline_status (client_id, period_id, stage, provisional_opening)
VALUES
  ('d1000001-0000-4000-8000-000000000001', 'd2000001-0000-4000-8000-000000000001', 'DOCS_COLLECTING', true),
  ('d1000001-0000-4000-8000-000000000002', 'd2000001-0000-4000-8000-000000000002', 'DOCS_COLLECTING', true),
  ('d1000001-0000-4000-8000-000000000003', 'd2000001-0000-4000-8000-000000000003', 'DOCS_COLLECTING', true)
ON CONFLICT (client_id, period_id) DO NOTHING;
