/**
 * FILE: packages/server/supabase/scripts/hosted-llm-smoke.ts
 * PURPOSE: Operator smoke test for Mushi-hosted AI (the platform keys): for
 *          each feature, run the real platform path (`withPlatformRoute`,
 *          llm-failover.ts) once on its KENSAURUS AI route and print the
 *          route source, provider, model and ok (CONTRACT 2026-11-21 §4).
 *
 * Run from the repo root with the platform keys and the routes token in your
 * environment (names only: OPENAI_API_KEY, OPENROUTER_API_KEY,
 * KENSAURUS_ROUTES_TOKEN, optional KENSAURUS_ROUTES_URL):
 *
 *   DENO_NO_PACKAGE_JSON=1 deno run --no-lock --node-modules-dir=none \
 *     --allow-env --allow-net --env-file=.env \
 *     packages/server/supabase/scripts/hosted-llm-smoke.ts [--features a,b]
 *
 * The drill: turn the priority-1 provider off on kenji (Providers & AI routes →
 * the provider's switch, i.e. `kensaurus_provider_accounts.enabled = false`;
 * today that is openai), wait 60 s, run this again: every line must say
 * `source=live provider=openrouter fallback=true`. Turn it back on after.
 * (An anthropic switch proves nothing here: with no app, Claude rows are
 * skipped anyway.)
 *
 * No app, so the route's OpenAI-compatible candidates answer, as for Ask Mushi
 * without an active app; a Claude row is skipped. At most 50 output tokens per
 * call. No database, wallet or Langfuse is touched. Keys are never printed.
 */
// Env first, modules after: settings are read when the modules load.
Deno.env.set('MUSHI_HOSTED_LLM_BILLING', 'off')
const argv = Deno.args
const featureArg = argv.includes('--features') ? argv[argv.indexOf('--features') + 1] : ''
const { classifyLlmError, sanitizeLlmError, withPlatformRoute } = await import('../functions/_shared/llm-failover.ts')
const { openAiCompatibleModelId } = await import('../functions/_shared/openai-model-id.ts')

const DEFAULT_FEATURES: Array<{ feature: string; tier: 'fast' | 'standard' | 'premium' }> = [
  { feature: 'ask-mushi', tier: 'fast' },
  { feature: 'classify-report', tier: 'standard' },
  { feature: 'fix-worker', tier: 'premium' },
]
const features = featureArg
  ? featureArg.split(',').map((f) => ({ feature: f.trim(), tier: 'standard' as const }))
  : DEFAULT_FEATURES

/** Plain fetch, shaped like the SDK errors the classifier reads (`<status> <body>`, numeric `status`). */
async function chat(base: string, key: string, model: string): Promise<string> {
  const res = await fetch(`${base.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, max_completion_tokens: 50, messages: [{ role: 'user', content: 'Reply with OK.' }] }),
    signal: AbortSignal.timeout(30_000),
  })
  const text = await res.text()
  if (!res.ok) throw Object.assign(new Error(`${res.status} ${text.slice(0, 400)}`), { status: res.status })
  return text
}

const db = { from: () => ({}), rpc: () => Promise.resolve({ data: null, error: null }) } as never
let failed = 0
for (const f of features) {
  const started = Date.now()
  try {
    const out = await withPlatformRoute(db, null, f, {
      openai: (key) => chat(key.baseUrl ?? 'https://api.openai.com/v1', key.key, openAiCompatibleModelId(key.model ?? 'gpt-6-luna', key.baseUrl)),
    })
    console.log(`ok    ${f.feature}: source=${out.routeSource} provider=${out.vendor} model=${out.model} fallback=${out.fallbackUsed} (${Date.now() - started} ms)`)
  } catch (err) {
    failed++
    console.log(`FAIL  ${f.feature}: ${classifyLlmError(err)}: ${sanitizeLlmError(err).slice(0, 240)}`)
  }
}
Deno.exit(failed > 0 ? 1 : 0)
