-- Clarify tin_provided_hash storage: server-side HMAC with TESTER_TIN_PEPPER,
-- not client-side bare SHA-256 (which is brute-forceable for short numeric TINs).

COMMENT ON COLUMN public.tester_kyc.tin_provided_hash IS
  'HMAC-SHA256 (hex) of normalized TIN keyed by TESTER_TIN_PEPPER env secret. Raw TIN never stored.';

COMMENT ON TABLE public.tester_kyc IS
  'KYC / tax-form status for testers. tax_form_collected_at must be set and '
  'withholding_status must be ''cleared'' before gift-card redemptions proceed. '
  'TIN is stored only as a server-side HMAC — never in plaintext.';
