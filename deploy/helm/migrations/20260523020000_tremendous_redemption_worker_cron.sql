-- Migration: tremendous-redemption-worker cron + mushi_runtime_config catalog seed
-- PURPOSE: Schedule the Tremendous gift-card worker every minute via pg_cron.
--          Also seeds the Tremendous SKU catalog and funding source config keys
--          so the runtime has safe defaults before the operator fills in real values.

-- ── pg_cron schedule ─────────────────────────────────────────────────────────
-- Only create the cron if pg_cron is available (self-hosted installs without
-- the extension will skip gracefully).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'tremendous-redemption-worker',
      '* * * * *',
      $$
        SELECT net.http_post(
          url    := (SELECT value FROM mushi_runtime_config WHERE key = 'edge_function_base_url')
                   || '/tremendous-redemption-worker',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || current_setting('app.service_role_key', true)
          ),
          body   := '{}'::jsonb
        ) AS request_id;
      $$
    );
  END IF;
END;
$$;

-- ── Seed mushi_runtime_config defaults ───────────────────────────────────────
-- These rows are safe sentinel defaults. The operator must replace
-- tremendous_funding_source_id with their real Tremendous funding source UUID
-- and set TREMENDOUS_API_KEY in the edge function environment.

INSERT INTO public.mushi_runtime_config (key, value, updated_at)
VALUES
  (
    'tremendous_funding_source_id',
    'REPLACE_WITH_YOUR_TREMENDOUS_FUNDING_SOURCE_ID',
    now()
  ),
  (
    'tremendous_catalog',
    '[
      {"sku":"AMAZON_GIFT_CARD",       "label":"Amazon",                  "face_values_usd":[5,10,25,50],   "country_codes":["US","GB","CA","AU","JP","DE","FR","IT","ES"], "points_per_dollar":100},
      {"sku":"VISA_GIFT_CARD",         "label":"Visa Prepaid",            "face_values_usd":[10,25,50],     "country_codes":["US"],                                        "points_per_dollar":100},
      {"sku":"STARBUCKS_GIFT_CARD",    "label":"Starbucks",               "face_values_usd":[5,10,25],      "country_codes":["US","CA","GB"],                              "points_per_dollar":100},
      {"sku":"APP_STORE_GIFT_CARD",    "label":"Apple App Store",         "face_values_usd":[5,10,25,50],   "country_codes":["US","GB","CA","AU","DE","FR","JP"],           "points_per_dollar":100},
      {"sku":"GOOGLE_PLAY_GIFT_CARD",  "label":"Google Play",             "face_values_usd":[5,10,25,50],   "country_codes":["US","GB","CA","AU","DE","FR","JP"],           "points_per_dollar":100},
      {"sku":"STEAM_GIFT_CARD",        "label":"Steam",                   "face_values_usd":[5,10,20,50],   "country_codes":["US","GB","CA","AU","DE","FR"],               "points_per_dollar":100},
      {"sku":"REWARD_GENIUS_GLOBAL",   "label":"100+ global rewards",     "face_values_usd":[10,25,50],     "country_codes":["*"],                                         "points_per_dollar":100}
    ]'::jsonb,
    now()
  )
ON CONFLICT (key) DO NOTHING;

-- ── tester_redemptions.status: add 'withheld' for anti-gaming workflow ────────
ALTER TABLE public.tester_redemptions
  DROP CONSTRAINT IF EXISTS tester_redemptions_status_check;

ALTER TABLE public.tester_redemptions
  ADD CONSTRAINT tester_redemptions_status_check
  CHECK (status IN ('pending','processing','complete','failed','reversed','withheld'));

-- ── Index for AntiGamingPage withheld-redemptions query ───────────────────────
CREATE INDEX IF NOT EXISTS idx_tester_redemptions_withheld
  ON public.tester_redemptions (tester_id, requested_at DESC)
  WHERE status = 'withheld';
