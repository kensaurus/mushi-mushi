-- Move OpenRouter keys saved under 'openai' (base_url on openrouter.ai) to the
-- 'openrouter' provider added in 20261005100000. Apply after the edge
-- functions that resolve 'openrouter' are deployed.
--
-- base_url is cleared: byok_keys_base_url_check allows it for 'openai' only,
-- and an OpenRouter key always uses https://openrouter.ai/api/v1.
-- The key itself (vault_secret_id), its label, priority, status and test
-- results are kept. Idempotent: a second run matches no rows.

UPDATE public.byok_keys
SET provider_slug = 'openrouter',
    base_url = NULL
WHERE provider_slug = 'openai'
  AND base_url IS NOT NULL
  AND lower(substring(base_url from '^https?://([^/:]+)')) IN ('openrouter.ai', 'www.openrouter.ai');
