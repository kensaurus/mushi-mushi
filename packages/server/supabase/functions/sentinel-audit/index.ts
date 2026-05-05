// ============================================================
// sentinel-audit — the Sentinel sub-agent (whitepaper §4.3)
//
// What it does
// ────────────
// For each test (file + name + body) handed in by the CI gate:
//   - Asks an LLM whether the test would catch the failure mode it
//     CLAIMS to verify, OR whether it's a "vacuous test" — a passing
//     spec that asserts nothing meaningful (the agentic-coding answer
//     to "make the build go green").
//   - Records the verdict (`approved` | `rejected`) + reasoning +
//     suggested missing assertions in `sentinel_verdicts`.
//
// Why it matters
// ──────────────
// Status Reconciler only promotes an Action to 🟢 verified when EVERY
// verifying test is Sentinel-approved. So a rejected verdict here is
// the deterministic block on "I added an empty Playwright spec and now
// the gate passes" gaming.
//
// Cost discipline
// ───────────────
// We dedupe via the unique index on
// (project_id, test_file, test_name, commit_sha): once a verdict is
// recorded for a (test, commit), we serve it from cache until the next
// commit changes that test. The CI runner is supposed to only ask us
// about tests in the diff — but we do the cache check anyway so a
// stale call is cheap.
// ============================================================

import { createAnthropic } from 'npm:@ai-sdk/anthropic@1'
import { generateObject } from 'npm:ai@4'
import { z } from 'npm:zod@3'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

import { getServiceClient } from '../_shared/db.ts'
import { log } from '../_shared/logger.ts'
import { withSentry } from '../_shared/sentry.ts'
import { requireServiceRoleAuth } from '../_shared/auth.ts'
import { resolveLlmKey } from '../_shared/byok.ts'
import { logLlmInvocation } from '../_shared/telemetry.ts'

declare const Deno: {
  serve(handler: (req: Request) => Response | Promise<Response>): void
  env: { get(name: string): string | undefined }
}

const rlog = log.child('sentinel-audit')

const SENTINEL_MODEL = 'claude-3-5-haiku-20241022'

// Whitepaper Appendix E Sentinel system prompt — copied verbatim so the
// behaviour stays auditable without re-reading the function body.
const SENTINEL_SYSTEM_PROMPT = `You are SENTINEL, a code-review sub-agent for the Mushi Mushi v2 inventory.

Your single job: given a Playwright / Vitest / Jest test, decide whether the test
WOULD CATCH a regression of the action it claims to verify. If yes → APPROVED.
If the test is empty, asserts nothing observable, asserts only that the page
renders without error, or only checks the visibility of a static label — REJECTED.

Examples of REJECTED:
  - test('login works', () => { await page.goto('/login'); /* nothing else */ })
  - test('submits answer', () => { expect(true).toBe(true) })
  - test('shows pricing', () => { await expect(page.locator('h1')).toBeVisible() })
    (when the action is "buys Pro plan")

Examples of APPROVED:
  - A Playwright test that clicks a button AND asserts a network call AND
    asserts a DB row was inserted (via a test-only RPC).
  - A test that simulates the failure mode in the original report and
    asserts the user-visible repair.

You return ONLY structured JSON with the verdict, brief reasoning, and a
suggested set of additional assertions when REJECTED.`

const verdictSchema = z.object({
  verdict: z.enum(['approved', 'rejected']),
  reasoning: z.string().max(800),
  suggested_assertions: z.array(z.string().max(300)).optional(),
})

interface RequestBody {
  project_id?: string
  commit_sha?: string | null
  tests?: Array<{
    file: string
    name: string
    body: string
    action_label?: string
    action_node_id?: string
  }>
}

async function evaluateTest(
  db: SupabaseClient,
  projectId: string,
  commitSha: string | null,
  test: { file: string; name: string; body: string; action_label?: string },
): Promise<{ verdict: 'approved' | 'rejected'; reasoning: string; cached: boolean; suggested?: string[] }> {
  // Cache check.
  const { data: cached } = await db
    .from('sentinel_verdicts')
    .select('verdict, reasoning, suggested_assertions')
    .eq('project_id', projectId)
    .eq('test_file', test.file)
    .eq('test_name', test.name)
    .eq('commit_sha', commitSha ?? '')
    .maybeSingle()
  if (cached && cached.verdict && cached.verdict !== 'unknown') {
    return {
      verdict: cached.verdict as 'approved' | 'rejected',
      reasoning: (cached.reasoning as string) ?? '',
      cached: true,
      suggested: (cached.suggested_assertions as string[] | null) ?? undefined,
    }
  }

  const prompt = `## Test under review
File: ${test.file}
Name: ${test.name}
${test.action_label ? `Action it claims to verify: ${test.action_label}\n` : ''}
\`\`\`
${test.body.slice(0, 8000)}
\`\`\`

Decide whether this test would catch a regression of the named action. If the
test asserts nothing observable, return verdict=rejected with concrete
suggested_assertions. Otherwise verdict=approved with a one-sentence reason.`

  const start = Date.now()
  const resolved = await resolveLlmKey(db, projectId, 'anthropic')
  const apiKey = resolved?.key ?? Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) {
    rlog.warn('no anthropic key — degrading to unknown', { project: projectId })
    await db.from('sentinel_verdicts').insert({
      project_id: projectId,
      test_file: test.file,
      test_name: test.name,
      commit_sha: commitSha ?? '',
      verdict: 'unknown',
      reasoning: 'no LLM key configured',
    })
    return { verdict: 'rejected', reasoning: 'no LLM key configured', cached: false }
  }
  const anthropic = createAnthropic({ apiKey })

  try {
    const { object: result, usage } = await generateObject({
      model: anthropic(SENTINEL_MODEL),
      schema: verdictSchema,
      system: SENTINEL_SYSTEM_PROMPT,
      prompt,
    })
    await logLlmInvocation(db, {
      projectId,
      functionName: 'sentinel-audit',
      stage: 'sentinel',
      primaryModel: SENTINEL_MODEL,
      usedModel: SENTINEL_MODEL,
      fallbackUsed: false,
      status: 'success',
      latencyMs: Date.now() - start,
      inputTokens: usage?.promptTokens,
      outputTokens: usage?.completionTokens,
      keySource: resolved?.source ?? 'env',
    })

    await db.from('sentinel_verdicts').upsert({
      project_id: projectId,
      test_file: test.file,
      test_name: test.name,
      commit_sha: commitSha ?? '',
      verdict: result.verdict,
      reasoning: result.reasoning,
      suggested_assertions: result.suggested_assertions ?? null,
    })

    return {
      verdict: result.verdict,
      reasoning: result.reasoning,
      cached: false,
      suggested: result.suggested_assertions,
    }
  } catch (err) {
    await logLlmInvocation(db, {
      projectId,
      functionName: 'sentinel-audit',
      stage: 'sentinel',
      primaryModel: SENTINEL_MODEL,
      usedModel: SENTINEL_MODEL,
      fallbackUsed: false,
      status: 'error',
      errorMessage: String(err),
      latencyMs: Date.now() - start,
      keySource: resolved?.source ?? 'env',
    })
    rlog.error('sentinel LLM failed', { test: `${test.file}::${test.name}`, err: String(err) })
    return { verdict: 'rejected', reasoning: 'sentinel-audit failed; defaulting to rejected', cached: false }
  }
}

async function handler(req: Request): Promise<Response> {
  const authResp = requireServiceRoleAuth(req)
  if (authResp) return authResp

  let body: RequestBody
  try {
    body = (await req.json()) as RequestBody
  } catch {
    return new Response(JSON.stringify({ ok: false, error: { code: 'INVALID_JSON' } }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  if (!body.project_id) {
    return new Response(
      JSON.stringify({ ok: false, error: { code: 'MISSING_PROJECT', message: 'project_id required' } }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    )
  }
  const tests = body.tests ?? []
  const db = getServiceClient()

  const results = await Promise.all(
    tests.map((t) =>
      evaluateTest(db, body.project_id!, body.commit_sha ?? null, t).then((r) => ({
        file: t.file,
        name: t.name,
        ...r,
      })),
    ),
  )

  return new Response(
    JSON.stringify({ ok: true, data: { results } }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
}

if (typeof Deno !== 'undefined') {
  Deno.serve(withSentry('sentinel-audit', handler))
}

export { evaluateTest, SENTINEL_SYSTEM_PROMPT }
