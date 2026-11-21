/**
 * FILE: packages/server/supabase/scripts/hosted-llm-smoke.ts
 * PURPOSE: Operator smoke test for Mushi-hosted AI (the platform keys): run
 *          the real choke point, `withAnthropicOrOpenAi` (llm-failover.ts →
 *          byok.ts → hosted-llm-order.ts), once per model tier against the
 *          live providers, and print which vendor and model answered.
 *
 * Run from the repo root, with the platform keys in your environment (names
 * only matter: ANTHROPIC_API_KEY, OPENAI_API_KEY, OPENROUTER_API_KEY, and
 * optionally MUSHI_HOSTED_LLM_ORDER / MUSHI_LLM_DRILL):
 *
 *   DENO_NO_PACKAGE_JSON=1 deno run --no-lock --node-modules-dir=none \
 *     --allow-env --allow-net --env-file=.env \
 *     packages/server/supabase/scripts/hosted-llm-smoke.ts [--drill] [--all-tiers]
 *
 *   --drill      Claude first, out of credit (MUSHI_HOSTED_LLM_ORDER=anthropic,openai,openrouter
 *                and MUSHI_LLM_DRILL=anthropic_no_credit for this run only): every
 *                line must still end `ok` on openai/openrouter.
 *   --all-tiers  Also the Sonnet tier (Terra) and the code tier (Sol). By default
 *                only the Haiku tier runs (Luna), ≤50 output tokens: a fraction of a cent.
 *
 * The app is a fake with no keys of its own, so every call takes the platform
 * path a Free Cloud app takes. No database, wallet or Langfuse is touched
 * (MUSHI_HOSTED_LLM_BILLING is forced off for this process). Keys are never
 * printed; a provider error is printed with its class (payment/quota/auth/…).
 * Production reads its keys from Supabase secrets: a stale local key shows up
 * here as a fallover, not as a production fault.
 */
// Env first, modules after: billing and failover settings are read when the modules load.
const args = new Set(Deno.args)
Deno.env.set('MUSHI_HOSTED_LLM_BILLING', 'off')
if (args.has('--drill')) {
  Deno.env.set('MUSHI_HOSTED_LLM_ORDER', 'anthropic,openai,openrouter')
  Deno.env.set('MUSHI_LLM_DRILL', 'anthropic_no_credit')
}
const { classifyLlmError, sanitizeLlmError, withAnthropicOrOpenAi } = await import('../functions/_shared/llm-failover.ts')
const { openAiCompatibleModelId } = await import('../functions/_shared/openai-model-id.ts')
const { hostedLlmOrder } = await import('../functions/_shared/hosted-llm-order.ts')
const {
  ANTHROPIC_HAIKU_LATEST,
  ANTHROPIC_OPUS_LATEST,
  ANTHROPIC_SONNET_LATEST,
  OPENAI_MINI,
  OPENAI_PRIMARY,
  OPENAI_TERRA,
} = await import('../functions/_shared/models.ts')

const TIERS = [
  { feature: 'ask-mushi / summaries (Haiku tier)', claude: ANTHROPIC_HAIKU_LATEST, openai: OPENAI_MINI },
  ...(args.has('--all-tiers')
    ? [
        { feature: 'classify / judge / inventory (Sonnet tier)', claude: ANTHROPIC_SONNET_LATEST, openai: OPENAI_TERRA },
        { feature: 'fix-worker / PR review (code tier)', claude: ANTHROPIC_OPUS_LATEST, openai: OPENAI_PRIMARY },
      ]
    : []),
]

const PROJECT = '00000000-0000-4000-8000-00000000500e'

/**
 * The providers are called with plain fetch, shaped like the SDK errors the
 * classifier reads (`<status> <body>` with a numeric `status`). The AI SDK
 * path is what production runs; this script proves the order, the fallover
 * and the keys, which is what a contingency flip changes.
 */
async function post(url: string, headers: Record<string, string>, body: unknown): Promise<unknown> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  })
  const text = await res.text()
  if (!res.ok) throw Object.assign(new Error(`${res.status} ${text.slice(0, 400)}`), { status: res.status })
  return JSON.parse(text)
}

/** An app in a Claude organization with no keys of its own: only the platform keys resolve. */
function fakeDb(): never {
  const from = (table: string) => {
    // deno-lint-ignore no-explicit-any
    const b: any = {
      select: () => b, eq: () => b, in: () => b, order: () => b, or: () => b, is: () => b,
      gte: () => b, lt: () => b, lte: () => b, limit: () => b, update: () => b,
      insert: () => Promise.resolve({ error: null }),
      single: () => Promise.resolve({ data: null, error: null }),
      maybeSingle: () =>
        Promise.resolve({
          data: table === 'projects' ? { organization_id: null } : null,
          error: null,
        }),
      then: (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    }
    return b
  }
  return { from, rpc: () => Promise.resolve({ data: null, error: null }) } as never
}

console.log(`hosted order: ${hostedLlmOrder().join(' > ')}${args.has('--drill') ? '  (drill: Claude out of credit)' : ''}`)
let failed = 0
for (const tier of TIERS) {
  const started = Date.now()
  let vendor = '?'
  let model = '?'
  try {
    const { usedProvider } = await withAnthropicOrOpenAi(
      fakeDb(),
      PROJECT,
      async (key) => {
        vendor = 'anthropic'
        model = tier.claude
        return await post('https://api.anthropic.com/v1/messages', { 'x-api-key': key.key, 'anthropic-version': '2023-06-01' }, {
          model: tier.claude,
          max_tokens: 50,
          messages: [{ role: 'user', content: 'Reply with OK.' }],
        })
      },
      async (key) => {
        vendor = key.provider === 'openrouter' ? 'openrouter' : 'openai'
        model = tier.openai
        const base = (key.baseUrl ?? 'https://api.openai.com/v1').replace(/\/+$/, '')
        return await post(`${base}/chat/completions`, { authorization: `Bearer ${key.key}` }, {
          model: openAiCompatibleModelId(tier.openai, key.baseUrl),
          max_completion_tokens: 50,
          messages: [{ role: 'user', content: 'Reply with OK.' }],
        })
      },
    )
    console.log(`ok    ${tier.feature}: ${usedProvider === 'anthropic' ? 'anthropic' : vendor} ${model} (${Date.now() - started} ms)`)
  } catch (err) {
    failed++
    console.log(`FAIL  ${tier.feature}: last tried ${vendor} ${model}: ${classifyLlmError(err)}: ${sanitizeLlmError(err).slice(0, 200)}`)
  }
}
Deno.exit(failed > 0 ? 1 : 0)
