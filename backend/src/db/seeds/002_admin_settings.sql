-- Admin-editable settings - see spec/decisions-and-phasing.md > Business Rules > Commission,
-- and > Customer Checkout Cost Breakdown. These are defaults; Admin can change them later
-- via the Admin dashboard without a rebuild.
INSERT INTO admin_settings (key, value, description) VALUES
  ('commission_percent', '15', 'Platform commission on Total Cost of Rent (Renter keeps the remainder).'),
  ('vat_percent', '7.5', 'VAT applied to Rent + Admin Costs combined, per the founder''s conservative choice pending tax-compliance research.'),
  ('admin_fee_naira', '100', 'TalcTech''s flat per-transaction admin fee (part of Admin Costs).'),
  ('sms_cost_naira', '5.90', 'Termii per-SMS cost, passed through to the Customer as part of Admin Costs.'),
  ('executive_subscription_naira', '10000', 'Executive Customer base monthly subscription fee, before Admin Costs/VAT.')
ON CONFLICT (key) DO NOTHING;
