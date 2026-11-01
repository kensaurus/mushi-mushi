-- ============================================================================
-- 20261101010100_byok_anthropic_base_url
--
-- Verifiably local (Plan 023 Phase 1, ADR 0034). An `anthropic` key may now
-- carry its own base URL: a local Anthropic-compatible server (Ollama's
-- Messages API, http://localhost:11434) or a gateway on
-- MUSHI_ANTHROPIC_BASE_URL_ALLOWLIST. The API validates it
-- (_shared/byok-validation.ts validateAnthropicBaseUrl); private hosts are
-- accepted only in local-only mode or with MUSHI_ALLOW_PRIVATE_LLM_ENDPOINT=1.
--
-- Widens byok_keys_base_url_length_check from 'openai' to 'openai' and
-- 'anthropic'. Every row valid before stays valid. ADDITIVE.
-- ============================================================================

ALTER TABLE public.byok_keys
  DROP CONSTRAINT IF EXISTS byok_keys_base_url_length_check;

ALTER TABLE public.byok_keys
  ADD CONSTRAINT byok_keys_base_url_length_check
  CHECK (
    base_url IS NULL
    OR (
      provider_slug IN ('openai', 'anthropic')
      AND char_length(base_url) BETWEEN 1 AND 2048
    )
  );

COMMENT ON COLUMN public.byok_keys.base_url IS
  'Validated endpoint: an OpenAI-compatible provider for openai keys, an Anthropic-compatible API root for anthropic keys. NULL uses the platform base URL (OPENAI_BASE_URL / ANTHROPIC_BASE_URL) or the vendor API.';
