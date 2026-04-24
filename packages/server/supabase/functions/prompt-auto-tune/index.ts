/**
 * prompt-auto-tune — §4 weekly cron.
 *
 * For each project with judge_enabled and at least N recent failed
 * evaluations, propose a candidate prompt that addresses the dominant
 * failure modes and inserts it into `prompt_versions` as an auto-generated
 * candidate (`auto_generated=true, is_candidate=true, traffic_percentage=0`).
 *
 * The function never auto-promotes — it only files candidates. A human
 * operator reviews the diff in the Prompt Lab UI and bumps `traffic_percentage`
 * (or activates) when satisfied. After the candidate accumulates enough
 * judge scores at any non-zero traffic, judge-batch's normal
 * checkPromotionEligibility flow takes over.
 *
 * Auth: pg_cron POSTs with the service-role bearer; we re-validate
 * identically to library-modernizer / sentry-seer-poll. Never accept
 * external requests.
 *
 * Cost control:
 *   - Skips projects with no Anthropic key (BYOK or env).
 *   - Skips stages whose active prompt isn't backed by a `prompt_versions`
 *     row (nothing to fork).
 *   - Skips stages that already have an open auto-generated candidate
 *     younger than 14 days — operators get one proposal at a time.
 *   - Per stage, max 20 failure samples sent to the LLM.
 */

import { Hono } from 'npm:hono@4'
import { generateObject } from 'npm:ai@4'
import { createAnthropic } from 'npm:@ai-sdk/anthropic@1'
import { z } from 'npm:zod@3'
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { log as rootLog } from '../_shared/logger.ts'
import { ensureSentry, sentryHonoErrorHandler } from '../_shared/sentry.ts'
import { resolveLlmKey } from '../_shared/byok.ts'
import { createTrace } from '../_shared/observability.ts'
import { PROMPT_TUNE_MODEL } from '../_shared/models.ts'
import { requireServiceRoleAuth } from '../_shared/auth.ts'

ensureSentry('prompt-auto-tune')

const log = rootLog.child('prompt-auto-tune')
const app = new Hono()
app.onError(sentryHonoErrorHandler)

const STAGES = ['stage1', 'stage2'] as const
type Stage = (typeof STAGES)[number]

const MIN_FAILURES_PER_STAGE = 5
const MAX_FAILURES_TO_SAMPLE = 20
const LOW_SCORE_THRESHOLD = 0.6
const LOOKBACK_DAYS = 14
const COOLDOWN_DAYS = 14

const candidateSchema = z.object({
  prompt_template: z.string().min(50).describe('The new prompt template. Keep all template variables (e.g. {{report_text}}, {{categories}}) byte-identical.'),
  change_summary: z.string().min(10).max(500).describe('1-3 sentences explaining what changed and why.'),
  addressed_buckets: z.array(z.string()).describe('Disagreement bucket names this candidate is intended to fix.'),
})

function getDb(): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false } },
  )
}

// Wave S (2026-04-23): the hand-rolled `authorized()` only accepted the
// service-role key. Postgres cron (pg_net) can't read the auto-injected
// `SUPABASE_SERVICE_ROLE_KEY` — the Supabase CLI refuses to set secrets that
// start with `SUPABASE_` — so every pg_cron caller of this function actually
// sent `MUSHI_INTERNAL_CALLER_SECRET`, which this check rejected. We now
// delegate to the shared `requireServiceRoleAuth` which accepts either
// secret via constant-time compare.

interface FailureSample {
  reportDescription: string
  category: string | null
  severity: string | null
  component: string | null
  judgeScore: number
  classificationAgreed: boolean
  disagreementReason: string | null
  judgeReasoning: string | null
  suggestedCorrection: unknown
}

async function loadFailures(
  db: SupabaseClient,
  projectId: string,
  promptVersion: string,
): Promise<FailureSample[]> {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString()
  // Pull evaluations + nest the underlying report so we can show the LLM
  // what the input actually looked like, not just the judge's complaint.
  const { data, error } = await db
    .from('classification_evaluations')
    .select(`
      judge_score,
      classification_agreed,
      disagreement_reason,
      judge_reasoning,
      suggested_correction,
      reports!inner(description, category, severity, component)
    `)
    .eq('project_id', projectId)
    .eq('prompt_version', promptVersion)
    .or(`classification_agreed.eq.false,judge_score.lt.${LOW_SCORE_THRESHOLD}`)
    .gte('created_at', since)
    .order('judge_score', { ascending: true })
    .limit(MAX_FAILURES_TO_SAMPLE)

  if (error) {
    log.warn('failure-load failed', { projectId, promptVersion, error: error.message })
    return []
  }

  return (data ?? []).map((row) => {
    const report = row.reports as unknown as {
      description: string
      category: string | null
      severity: string | null
      component: string | null
    }
    return {
      reportDescription: report.description ?? '',
      category: report.category,
      severity: report.severity,
      component: report.component,
      judgeScore: row.judge_score,
      classificationAgreed: row.classification_agreed,
      disagreementReason: row.disagreement_reason,
      judgeReasoning: row.judge_reasoning,
      suggestedCorrection: row.suggested_correction,
    } satisfies FailureSample
  })
}

function bucketize(failures: FailureSample[]): Array<{ reason: string; count: number }> {
  const counts = new Map<string, number>()
  for (const f of failures) {
    const key = f.disagreementReason ?? (f.classificationAgreed ? 'low_score' : 'unknown_disagreement')
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count)
}

interface AutoCandidate {
  promptTemplate: string
  changeSummary: string
  addressedBuckets: string[]
  failureCount: number
  topBuckets: Array<{ reason: string; count: number }>
  parentVersion: string
  parentVersionId: string
  model: string
}

async function proposeCandidate(
  db: SupabaseClient,
  projectId: string,
  stage: Stage,
  active: { id: string; version: string; prompt_template: string },
  failures: FailureSample[],
): Promise<AutoCandidate | null> {
  const buckets = bucketize(failures)
  const trace = createTrace('prompt-auto-tune', { projectId, stage, parentVersion: active.version })

  const resolved = await resolveLlmKey(db, projectId, 'anthropic').catch(() => null)
  const apiKey = resolved?.key ?? Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) {
    log.info('skipping — no Anthropic key', { projectId, stage })
    await trace.end()
    return null
  }

  const anthropic = createAnthropic({ apiKey })
  // Wave R (2026-04-22): Promoted from Sonnet 4-6 to Opus 4-7 — prompt rewrites
  // benefit most from the frontier self-critique. Falls back silently when
  // Opus isn't in the account; the judge-batch evaluator re-scores outputs
  // regardless.
  const model = PROMPT_TUNE_MODEL

  const failuresPrompt = failures
    .map((f, i) => `### Failure ${i + 1} (judge_score=${f.judgeScore.toFixed(2)}, bucket=${f.disagreementReason ?? 'low_score'})
Original report: ${f.reportDescription.slice(0, 400)}
Classifier output: category=${f.category ?? '?'}, severity=${f.severity ?? '?'}, component=${f.component ?? '?'}
Judge said: ${(f.judgeReasoning ?? '').slice(0, 300)}
Judge's correction: ${JSON.stringify(f.suggestedCorrection ?? {}).slice(0, 200)}`)
    .join('\n\n')

  const span = trace.span('generate-candidate')
  // Sentry MUSHI-MUSHI-SERVER-9 (2026-04-23, then 2026-04-24 03:00 UTC):
  // Opus 4.7 dropped sampling knobs. AI SDK v4 hardcodes `temperature ?? 0`
  // — flipping Anthropic into thinking mode strips it BUT also trips
  // Anthropic's "thinking + tool_choice forces tool use" 400, which
  // `generateObject` always forces. Until vercel/ai ships native
  // middleware (vercel/ai#7220 / #9351), PROMPT_TUNE_MODEL stays on
  // Sonnet 4.6 — accepts `temperature: 0` and works with `generateObject`
  // directly. See `_shared/models.ts` `acceptsSamplingKnobs` for the full
  // migration note.
  try {
    const { object, usage } = await generateObject({
      model: anthropic(model),
      schema: candidateSchema,
      temperature: 0,
      system: `You are a senior prompt engineer for an automated bug-classification pipeline. You will be shown the current prompt for ${stage} and a sample of recent classifications the LLM judge disagreed with. Propose a revised prompt that addresses the dominant failure modes WITHOUT changing template variables (anything inside {{ ... }}) or breaking the existing output schema.

Hard constraints:
- Keep every {{template_variable}} byte-identical and in the same position.
- Do NOT introduce new variables — the worker won't substitute them.
- Do NOT change the output JSON schema the worker expects.
- Make changes minimal and targeted. If a failure bucket is "wrong_severity", clarify the severity rubric. If "vague_repro", strengthen the repro instructions. If "wrong_component", expand the component rubric or list valid components.
- Output the FULL revised prompt template, not a diff.`,
      prompt: `Current active prompt (version ${active.version}):

\`\`\`
${active.prompt_template}
\`\`\`

Top failure buckets in the last ${LOOKBACK_DAYS} days:
${buckets.map((b) => `- ${b.reason}: ${b.count}`).join('\n')}

Sample failures (${failures.length} of the worst-scoring):

${failuresPrompt}

Propose a revised prompt that fixes the dominant failure modes.`,
    })
    span.end({ model, inputTokens: usage?.promptTokens, outputTokens: usage?.completionTokens })
    await trace.end()

    return {
      promptTemplate: object.prompt_template,
      changeSummary: object.change_summary,
      addressedBuckets: object.addressed_buckets,
      failureCount: failures.length,
      topBuckets: buckets,
      parentVersion: active.version,
      parentVersionId: active.id,
      model,
    }
  } catch (e) {
    span.end({ error: (e as Error).message })
    await trace.end()
    log.warn('LLM proposal failed', { projectId, stage, error: String(e) })
    return null
  }
}

async function processStage(
  db: SupabaseClient,
  projectId: string,
  stage: Stage,
): Promise<{ status: 'ok' | 'skipped' | 'failed'; reason: string; candidateId?: string }> {
  // Resolve the active prompt for this scope. We auto-tune project-scoped
  // prompts directly; the global defaults stay frozen so a regression in
  // one project never bleeds across the platform.
  //
  // Wave S (2026-04-23) — previously, projects that had NEVER forked the
  // global prompt were silently skipped ("no project-scoped active
  // prompt"). That meant a brand-new tenant accumulating bad judge scores
  // never got an auto-candidate, even though the tuner has all the data
  // it needs. We now fall back to forking the matching global-scope
  // prompt: the candidate we insert is still project-scoped (so the
  // platform default is untouched), but the operator gets a first
  // proposal instead of a cold start.
  let active = (await db
    .from('prompt_versions')
    .select('id, version, prompt_template')
    .eq('project_id', projectId)
    .eq('stage', stage)
    .eq('is_active', true)
    .maybeSingle()).data as { id: string; version: string; prompt_template: string } | null

  let forkedFromGlobal = false
  if (!active) {
    const { data: globalActive } = await db
      .from('prompt_versions')
      .select('id, version, prompt_template')
      .is('project_id', null)
      .eq('stage', stage)
      .eq('is_active', true)
      .maybeSingle()
    if (!globalActive) {
      return { status: 'skipped', reason: 'no active prompt (neither project nor global)' }
    }
    active = globalActive
    forkedFromGlobal = true
  }

  // Cooldown: don't pile up auto candidates if one is already pending.
  const cutoff = new Date(Date.now() - COOLDOWN_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const { data: existing } = await db
    .from('prompt_versions')
    .select('id, created_at')
    .eq('project_id', projectId)
    .eq('stage', stage)
    .eq('auto_generated', true)
    .eq('is_active', false)
    .gte('created_at', cutoff)
    .maybeSingle()
  if (existing) {
    return { status: 'skipped', reason: `auto candidate already open (${existing.id.slice(0, 8)})` }
  }

  const failures = await loadFailures(db, projectId, active.version)
  if (failures.length < MIN_FAILURES_PER_STAGE) {
    return { status: 'skipped', reason: `only ${failures.length}/${MIN_FAILURES_PER_STAGE} failures in lookback window` }
  }

  const candidate = await proposeCandidate(db, projectId, stage, active, failures)
  if (!candidate) return { status: 'skipped', reason: 'proposal returned no candidate' }

  // Sanity check: refuse to insert a proposal that's identical to the active
  // template (the LLM occasionally hedges and returns the input verbatim).
  if (candidate.promptTemplate.trim() === active.prompt_template.trim()) {
    return { status: 'skipped', reason: 'proposal identical to active prompt' }
  }

  const newVersion = `${active.version}-auto-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`

  const { data: inserted, error } = await db
    .from('prompt_versions')
    .insert({
      project_id: projectId,
      stage,
      version: newVersion,
      prompt_template: candidate.promptTemplate,
      is_candidate: true,
      is_active: false,
      // Operator must opt in to traffic. We never auto-route real reports
      // to a machine-generated prompt without human approval.
      traffic_percentage: 0,
      auto_generated: true,
      parent_version_id: candidate.parentVersionId,
      auto_generation_metadata: {
        parentVersion: candidate.parentVersion,
        failureCount: candidate.failureCount,
        topBuckets: candidate.topBuckets,
        addressedBuckets: candidate.addressedBuckets,
        changeSummary: candidate.changeSummary,
        generatedAt: new Date().toISOString(),
        model: candidate.model,
        // Wave S (2026-04-23): expose the fork source so the Prompt Lab
        // can badge "forked from global defaults" on the first candidate
        // a tenant ever sees — otherwise it's indistinguishable from a
        // regular iteration of the tenant's own prompt.
        forkedFromGlobal,
      },
    })
    .select('id')
    .single()

  if (error || !inserted) {
    return { status: 'failed', reason: error?.message ?? 'insert returned no row' }
  }

  return { status: 'ok', reason: `created ${newVersion}`, candidateId: inserted.id }
}

interface StageResult {
  projectId: string
  stage: Stage
  status: 'ok' | 'skipped' | 'failed'
  reason: string
  candidateId?: string
}

app.get('/prompt-auto-tune/health', (c) => c.json({ ok: true }))

app.post('/prompt-auto-tune', async (c) => {
  const unauthorized = requireServiceRoleAuth(c.req.raw)
  if (unauthorized) return unauthorized

  const db = getDb()

  const { data: projects } = await db
    .from('projects')
    .select('id, name, project_settings!inner(judge_enabled)')
    .eq('project_settings.judge_enabled', true)

  if (!projects?.length) {
    return c.json({ ok: true, message: 'no projects with judge enabled', results: [] })
  }

  const results: StageResult[] = []
  for (const p of projects) {
    for (const stage of STAGES) {
      try {
        const r = await processStage(db, p.id, stage)
        results.push({ projectId: p.id, stage, ...r })
      } catch (e) {
        log.error('stage failed', { projectId: p.id, stage, error: String(e) })
        results.push({ projectId: p.id, stage, status: 'failed', reason: String(e) })
      }
    }
  }

  const created = results.filter((r) => r.status === 'ok').length
  log.info('auto-tune sweep complete', {
    projectsChecked: projects.length,
    created,
    skipped: results.filter((r) => r.status === 'skipped').length,
    failed: results.filter((r) => r.status === 'failed').length,
  })

  return c.json({ ok: true, projectsChecked: projects.length, created, results })
})

Deno.serve(app.fetch)
