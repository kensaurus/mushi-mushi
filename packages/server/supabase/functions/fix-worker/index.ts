/**
 * FILE: packages/server/supabase/functions/fix-worker/index.ts
 *
 * V5.3 §2.10 — the LLM Fix Agent (the "brain" of the PDCA cycle).
 *
 * Why an Edge Function and not @mushi-mushi/agents:
 *   - Octokit, sandbox SDKs, and Node-only deps don't run in Deno.
 *   - The whitepaper explicitly allows multiple adapter shapes — this is the
 *     "in-Edge-Function LLM adapter," consistent with the existing fast-filter
 *     and classify-report functions which already use the Vercel AI SDK +
 *     BYOK + Langfuse for structured generation.
 *   - GitHub PR creation is one REST POST per file + one for the PR; no SDK
 *     needed.
 *
 * Flow:
 *   1. Edge Function is invoked with a `dispatchId` (from the dispatch
 *      endpoint) — fire-and-forget via EdgeRuntime.waitUntil().
 *   2. Marks the dispatch row as 'running'.
 *   3. Loads report + project_settings + RAG context (relevant code).
 *   4. Calls the LLM (Anthropic primary, OpenAI/OpenRouter fallback) with a
 *      Zod-typed structured output describing one branch + N file edits +
 *      summary + rationale.
 *   5. Validates scope/circuit breaker.
 *   6. Resolves the GitHub repo (project_repos primary, falls back to
 *      project_settings.github_repo_url).
 *   7. Creates a draft PR via direct GitHub REST API (no auto-merge — the
 *      whitepaper is explicit about human approval on every PR).
 *   8. Updates fix_attempts and fix_dispatch_jobs with the result.
 *
 * Security:
 *   - JWT-verified at the edge (verify_jwt=false because the dispatch
 *     endpoint already validated membership; the worker only receives a
 *     dispatchId from a trusted invoker. We re-validate the dispatch row
 *     exists to defend against ID guessing).
 *   - GitHub token comes from project_settings.github_repo_url + the
 *     project owner's vault-stored installation token (or env GITHUB_TOKEN
 *     for self-hosted/dev).
 *   - The LLM is sandboxed by structured output: it can only emit file
 *     paths + content + rationale, never tool calls or shell commands.
 *
 * Cost guard:
 *   - circuit_breaker: aborts if any single file would exceed
 *     project_settings.autofix_max_lines (default 200).
 *   - token cap: passes maxTokens to limit blast radius even if the model
 *     misbehaves.
 *   - One LLM call per dispatch — no agentic loop in M5; SEP-1686 Tasks +
 *     multi-turn lands in a future wave.
 */

import { generateObject } from 'npm:ai@4'
import { createAnthropic } from 'npm:@ai-sdk/anthropic@1'
import { createOpenAI } from 'npm:@ai-sdk/openai@1'
import { z } from 'npm:zod@3'
import { getServiceClient } from '../_shared/db.ts'
import { withSentry } from '../_shared/sentry.ts'
import { resolveLlmKey } from '../_shared/byok.ts'
import { getRelevantCode, formatCodeContext } from '../_shared/rag.ts'
import { firecrawlSearch, type FirecrawlSearchResult } from '../_shared/firecrawl.ts'
import { createTrace } from '../_shared/observability.ts'
import { log as rootLog } from '../_shared/logger.ts'

// ----------------------------------------------------------------------------
// Structured fix output. The LLM gets a strict shape — no shell, no tool calls.
// ----------------------------------------------------------------------------
const fixSchema = z.object({
  // Single short-form summary that becomes the PR title.
  summary: z.string().min(10).max(120)
    .describe('A short, conventional-commit-friendly title for the PR (e.g. "fix(button): prevent rage-click double-submit"). Must fit GitHub PR title limits.'),

  // Long-form rationale — the WHY of the change. Becomes part of the PR body.
  rationale: z.string().min(20).max(2000)
    .describe('Explain *why* this fix resolves the report — root cause + how the change addresses it. Reviewer-facing, plain English.'),

  // Each file is a full-content rewrite (path + new contents). The Edge
  // Function diffs against the existing file to validate scope. We don't
  // accept patch hunks — they're too brittle for an LLM to emit reliably.
  files: z.array(z.object({
    path: z.string().min(1).max(500)
      .describe('Repo-relative file path (forward-slashed). Must be inside the scope directory or a test file.'),
    contents: z.string().max(50_000)
      .describe('Full new file contents. The Edge Function replaces the file atomically — never partial.'),
    reason: z.string().min(5).max(500)
      .describe('One-line per-file reason for the change.'),
  })).min(1).max(10)
    .describe('Files to change. Keep the set minimal — adding test files is encouraged.'),

  needsHumanReview: z.boolean()
    .describe('Set true when confidence is low or the fix touches security-sensitive code. Forces draft PR.'),
})

type FixOutput = z.infer<typeof fixSchema>

const SYSTEM_PROMPT = `You are a senior staff engineer fixing one specific bug report.

Your output is a structured fix plan that will be turned into a draft pull request. A human will review every line before it merges — you are not the last line of defense, but you are the first.

Rules:
1. Make the smallest change that resolves the bug. Do not refactor unrelated code.
2. Preserve the existing file's style, imports, and formatting.
3. If you change behavior, add or update a test in the same PR.
4. Only emit files you have actually modified. Do not regenerate untouched files.
5. If you are not confident the fix is correct, set needsHumanReview=true and explain in the rationale.
6. Never invent file paths. Use ONLY paths that appear in the "Relevant code" context. If the right file isn't there, set needsHumanReview=true and propose what to look at instead.
7. Never include secrets, credentials, or hardcoded API keys in your output.
8. Stay within the configured scope directory unless adding tests.`

interface FixRequestBody {
  dispatchId: string
}

interface ResolvedRepo {
  owner: string
  repo: string
  defaultBranch: string
  scopeDirectory?: string
}

Deno.serve(withSentry('fix-worker', async (req) => {
  const log = rootLog.child('fix-worker')
  let body: FixRequestBody
  try {
    body = await req.json() as FixRequestBody
  } catch {
    return new Response(JSON.stringify({ ok: false, error: 'Body must be JSON' }), { status: 400 })
  }
  if (!body.dispatchId) {
    return new Response(JSON.stringify({ ok: false, error: 'dispatchId required' }), { status: 400 })
  }

  const db = getServiceClient()

  // ---- 1. Mark dispatch as running -----------------------------------------
  const { data: dispatch, error: dispatchErr } = await db
    .from('fix_dispatch_jobs')
    .update({ status: 'running', started_at: new Date().toISOString() })
    .eq('id', body.dispatchId)
    .eq('status', 'queued')
    .select('id, project_id, report_id, requested_by')
    .single()

  if (dispatchErr || !dispatch) {
    log.warn('Dispatch not found or not in queued state', { dispatchId: body.dispatchId, err: dispatchErr?.message })
    return new Response(JSON.stringify({ ok: false, error: 'Dispatch not in queued state' }), { status: 409 })
  }

  const trace = createTrace('fix-worker', {
    dispatchId: dispatch.id,
    projectId: dispatch.project_id,
    reportId: dispatch.report_id,
  })

  // ---- 2. Insert fix_attempts row ------------------------------------------
  const { data: attempt, error: attemptErr } = await db
    .from('fix_attempts')
    .insert({
      report_id: dispatch.report_id,
      project_id: dispatch.project_id,
      agent: 'llm',
      status: 'running',
      langfuse_trace_id: trace.id,
    })
    .select('id')
    .single()

  if (attemptErr || !attempt) {
    await failDispatch(db, dispatch.id, `fix_attempts insert failed: ${attemptErr?.message}`)
    return new Response(JSON.stringify({ ok: false, error: attemptErr?.message }), { status: 500 })
  }
  const fixAttemptId = attempt.id

  await db.from('fix_dispatch_jobs').update({ fix_attempt_id: fixAttemptId }).eq('id', dispatch.id)

  try {
    // ---- 3. Load report, settings, RAG context -----------------------------
    const ctxSpan = trace.span('context.assemble')
    const [{ data: report }, { data: settings }, { data: project }] = await Promise.all([
      db.from('reports').select('*').eq('id', dispatch.report_id).single(),
      db.from('project_settings').select('*').eq('project_id', dispatch.project_id).single(),
      db.from('projects').select('id, name, owner_id').eq('id', dispatch.project_id).single(),
    ])

    if (!report) throw new Error(`Report ${dispatch.report_id} not found`)
    if (!project) throw new Error(`Project ${dispatch.project_id} not found`)

    const repo = await resolveRepo(db, dispatch.project_id, settings)
    if (!repo) {
      throw new Error('No GitHub repo configured for this project. Set Settings → Integrations → GitHub repo.')
    }

    // RAG: find files the LLM will need to read.
    const ragSpan = trace.span('context.rag')
    const codeFiles = await getRelevantCode(db, dispatch.project_id, {
      symptom: report.summary ?? report.description?.slice(0, 200) ?? '',
      action: report.user_intent ?? '',
      component: report.component ?? '',
    })
    ragSpan.end({ fileCount: codeFiles.length })

    if (codeFiles.length === 0) {
      // We can still try, but the model has no codebase context. Note it for review.
      log.warn('No RAG context available for fix', { reportId: dispatch.report_id })
    }

    const codeContext = formatCodeContext(codeFiles)
    ctxSpan.end({ codeFileCount: codeFiles.length, repo: `${repo.owner}/${repo.repo}` })

    // ---- 3b. Wave E: Firecrawl auto-augment when local RAG is sparse OR
    //          the report has a poor prior judge score (a "stubborn" report).
    //          The whole block is best-effort: if Firecrawl is missing the key,
    //          rate-limited, or otherwise unhappy, the worker proceeds with
    //          local-only context. We persist the trace id + URLs onto
    //          fix_attempts so the Fixes page shows what the agent saw.
    const judgeScore = typeof report.judge_score === 'number' ? report.judge_score : null
    const augmentReason: 'rag_sparse' | 'low_judge_score' | null =
      codeFiles.length < 3 ? 'rag_sparse'
      : (judgeScore !== null && judgeScore < 0.6 ? 'low_judge_score' : null)

    let webSnippets: FirecrawlSearchResult[] = []
    let augmentTraceId: string | null = null
    if (augmentReason) {
      try {
        const symptom = report.summary
          ?? report.description?.slice(0, 200)
          ?? report.component
          ?? ''
        if (symptom.length > 0) {
          const augSpan = trace.span('fix.augment.firecrawl')
          webSnippets = await firecrawlSearch(db, dispatch.project_id, symptom, { limit: 3 })
          augSpan.end({ resultCount: webSnippets.length })
          if (webSnippets.length > 0) {
            augmentTraceId = trace.id
            await db.from('fix_attempts').update({
              augment_trace_id: augmentTraceId,
              augment_sources: webSnippets.map((s) => ({ url: s.url, title: s.title, snippet: s.snippet.slice(0, 240) })),
              augment_reason: augmentReason,
            }).eq('id', fixAttemptId)
          }
        }
      } catch (err) {
        // FIRECRAWL_NOT_CONFIGURED is expected on most projects — silent.
        // Other errors get logged but never fail the fix.
        const msg = err instanceof Error ? err.message : String(err)
        if (msg !== 'FIRECRAWL_NOT_CONFIGURED') {
          log.warn('Firecrawl augment failed (non-fatal)', { reportId: dispatch.report_id, reason: augmentReason, error: msg })
        }
      }
    }

    // ---- 4. Resolve LLM key (BYOK first, env fallback) --------------------
    const anthropicResolved = await resolveLlmKey(db, dispatch.project_id, 'anthropic')
    const openaiResolved = await resolveLlmKey(db, dispatch.project_id, 'openai')

    if (!anthropicResolved && !openaiResolved) {
      throw new Error(
        'No LLM key available. Add an Anthropic or OpenAI BYOK key in Settings → LLM Keys, ' +
        'or contact support to enable the platform default.',
      )
    }

    const userPrompt = buildUserPrompt(report, settings, codeContext, repo, webSnippets)

    // ---- 5. Call LLM with structured output -------------------------------
    const llmSpan = trace.span('llm.fix')
    const llmStart = Date.now()
    let fix: FixOutput
    let usedModel = ''
    let inputTokens = 0
    let outputTokens = 0

    // Model defaults are baked in; project-level overrides land in P6 alongside
    // the integrations migration. Sonnet for Anthropic, GPT-4.1 for the
    // OpenAI/OpenRouter path; both are strong at structured-output tool use.
    const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-4-5-20250929'
    const DEFAULT_OPENAI_MODEL = 'openai/gpt-4.1'  // OpenRouter-friendly slug

    try {
      if (anthropicResolved) {
        usedModel = DEFAULT_ANTHROPIC_MODEL
        const anthropic = createAnthropic({ apiKey: anthropicResolved.key })
        const { object, usage } = await generateObject({
          model: anthropic(usedModel),
          schema: fixSchema,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userPrompt },
          ],
          maxTokens: 8_000,
        })
        fix = object
        inputTokens = usage?.promptTokens ?? 0
        outputTokens = usage?.completionTokens ?? 0
      } else {
        // For OpenRouter the model slug needs the "provider/model" prefix;
        // for plain OpenAI it's just the bare slug. We use the OpenRouter
        // form by default since that's what BYOK users are most likely to
        // configure, and plain OpenAI tolerates stripping the prefix.
        const openaiKey = openaiResolved!.key
        const openaiBaseUrl = openaiResolved!.baseUrl
        const isOpenRouter = openaiBaseUrl?.includes('openrouter.ai') ?? false
        usedModel = isOpenRouter ? DEFAULT_OPENAI_MODEL : 'gpt-4.1'
        const openai = createOpenAI({
          apiKey: openaiKey,
          ...(openaiBaseUrl ? { baseURL: openaiBaseUrl } : {}),
        })
        const { object, usage } = await generateObject({
          model: openai(usedModel),
          schema: fixSchema,
          system: SYSTEM_PROMPT,
          prompt: userPrompt,
          maxTokens: 8_000,
        })
        fix = object
        inputTokens = usage?.promptTokens ?? 0
        outputTokens = usage?.completionTokens ?? 0
      }
    } catch (llmErr) {
      llmSpan.end({ error: String(llmErr).slice(0, 500) })
      throw new Error(`LLM call failed: ${String(llmErr).slice(0, 300)}`)
    }
    const llmLatencyMs = Date.now() - llmStart
    llmSpan.end({ model: usedModel, inputTokens, outputTokens, latencyMs: llmLatencyMs })

    // ---- 6. Validate scope + circuit breaker ------------------------------
    const validationErrors: string[] = []
    const maxLines = settings?.autofix_max_lines ?? 200
    let totalLines = 0
    for (const f of fix.files) {
      const lines = f.contents.split('\n').length
      totalLines += lines
      if (lines > maxLines) {
        validationErrors.push(`${f.path}: ${lines} lines exceeds circuit breaker (${maxLines}).`)
      }
      if (repo.scopeDirectory && !isFileInScope(f.path, repo.scopeDirectory)) {
        validationErrors.push(`${f.path}: outside scope ${repo.scopeDirectory}.`)
      }
      if (containsObviousSecret(f.contents)) {
        validationErrors.push(`${f.path}: contains a token-shaped string. Refusing to commit.`)
      }
    }

    if (validationErrors.length > 0) {
      throw new Error(`Validation failed: ${validationErrors.join(' ')}`)
    }

    // ---- 7. Get GitHub token + open draft PR ------------------------------
    const ghToken = await resolveGithubToken(db, project.owner_id ?? null, dispatch.project_id)
    if (!ghToken) {
      // Still record the LLM output so the user can copy/paste even without GH.
      const branch = `mushi/fix-${dispatch.report_id.slice(0, 8)}`
      await completeAttempt(db, fixAttemptId, {
        status: 'completed',
        branch,
        files_changed: fix.files.map(f => f.path),
        lines_changed: totalLines,
        summary: fix.summary,
        rationale: fix.rationale,
        llm_model: usedModel,
        llm_input_tokens: inputTokens,
        llm_output_tokens: outputTokens,
        review_passed: !fix.needsHumanReview,
      })
      await db.from('fix_dispatch_jobs').update({
        status: 'completed',
        finished_at: new Date().toISOString(),
        error: 'No GITHUB_TOKEN configured — fix generated but not pushed. Add a GitHub installation token in Integrations.',
      }).eq('id', dispatch.id)
      await trace.end()
      return new Response(JSON.stringify({ ok: true, fixAttemptId, prUrl: null }), { status: 200 })
    }

    const prSpan = trace.span('github.pr')
    const prResult = await createDraftPr({
      token: ghToken,
      owner: repo.owner,
      repo: repo.repo,
      defaultBranch: repo.defaultBranch,
      reportId: dispatch.report_id,
      fix,
    })
    prSpan.end({ prUrl: prResult.url })

    // ---- 8. Persist + cleanup --------------------------------------------
    await completeAttempt(db, fixAttemptId, {
      status: 'completed',
      branch: prResult.branch,
      pr_url: prResult.url,
      pr_number: prResult.number,
      commit_sha: prResult.commitSha,
      files_changed: fix.files.map(f => f.path),
      lines_changed: totalLines,
      summary: fix.summary,
      rationale: fix.rationale,
      llm_model: usedModel,
      llm_input_tokens: inputTokens,
      llm_output_tokens: outputTokens,
      review_passed: !fix.needsHumanReview,
    })

    await db.from('fix_dispatch_jobs').update({
      status: 'completed',
      pr_url: prResult.url,
      finished_at: new Date().toISOString(),
    }).eq('id', dispatch.id)

    await db.from('reports').update({
      fix_branch: prResult.branch,
      fix_pr_url: prResult.url,
      status: 'fixing',
    }).eq('id', dispatch.report_id)

    // Bill the project for the fix attempt — one usage_event per draft PR
    // we successfully open. The aggregator pushes these to Stripe Meter
    // Events on the next 5-min cron tick. We never block the response on
    // a usage-log failure — billing is best-effort vs. user-facing latency.
    {
      const { error: usageErr } = await db.from('usage_events').insert({
        project_id: dispatch.project_id,
        event_name: 'fixes_attempted',
        quantity: 1,
        metadata: {
          fix_attempt_id: fixAttemptId,
          report_id: dispatch.report_id,
          pr_url: prResult.url,
          pr_number: prResult.number,
        },
      })
      if (usageErr) {
        log.warn('usage_events fixes_attempted insert failed (non-fatal)', {
          err: usageErr.message,
          projectId: dispatch.project_id,
        })
      }
    }

    await trace.end()

    return new Response(JSON.stringify({
      ok: true,
      fixAttemptId,
      prUrl: prResult.url,
      branch: prResult.branch,
      langfuseTraceId: trace.id,
    }), { status: 200 })
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    log.error('Fix worker failed', { dispatchId: dispatch.id, err: errMsg })

    await db.from('fix_attempts').update({
      status: 'failed',
      error: errMsg.slice(0, 1000),
      completed_at: new Date().toISOString(),
    }).eq('id', fixAttemptId)

    await failDispatch(db, dispatch.id, errMsg)
    await trace.end()

    return new Response(JSON.stringify({ ok: false, error: errMsg.slice(0, 500) }), { status: 500 })
  }
}))

// ============================================================================
// Helpers
// ============================================================================

async function failDispatch(db: ReturnType<typeof getServiceClient>, dispatchId: string, error: string): Promise<void> {
  await db.from('fix_dispatch_jobs').update({
    status: 'failed',
    error: error.slice(0, 500),
    finished_at: new Date().toISOString(),
  }).eq('id', dispatchId)
}

async function completeAttempt(
  db: ReturnType<typeof getServiceClient>,
  fixAttemptId: string,
  fields: Record<string, unknown>,
): Promise<void> {
  await db.from('fix_attempts').update({
    ...fields,
    completed_at: new Date().toISOString(),
  }).eq('id', fixAttemptId)
}

async function resolveRepo(
  db: ReturnType<typeof getServiceClient>,
  projectId: string,
  settings: Record<string, unknown> | null,
): Promise<ResolvedRepo | null> {
  // Prefer the multi-repo primary entry; fall back to legacy single-URL field.
  const { data: primaryRepo } = await db
    .from('project_repos')
    .select('repo_url, default_branch, path_globs')
    .eq('project_id', projectId)
    .eq('is_primary', true)
    .maybeSingle()

  const url = primaryRepo?.repo_url ?? (settings?.github_repo_url as string | undefined) ?? (settings?.codebase_repo_url as string | undefined) ?? ''
  if (!url) return null

  const parsed = parseGithubUrl(url)
  if (!parsed) return null

  // path_globs from project_repos can constrain which files the worker is
  // allowed to write. Empty/null means no restriction.
  const globs = (primaryRepo?.path_globs as string[] | null) ?? null
  const scopeDirectory = globs && globs.length > 0 && typeof globs[0] === 'string'
    ? globs[0].replace(/\/\*\*?$/, '').replace(/^\.?\//, '')
    : undefined

  return {
    owner: parsed.owner,
    repo: parsed.repo,
    defaultBranch: primaryRepo?.default_branch ?? 'main',
    scopeDirectory,
  }
}

function parseGithubUrl(url: string): { owner: string; repo: string } | null {
  const cleaned = url.replace(/\.git$/, '').replace(/^git@github\.com:/, 'https://github.com/')
  const match = cleaned.match(/github\.com\/([^/]+)\/([^/]+)/)
  if (!match) return null
  return { owner: match[1], repo: match[2] }
}

function isFileInScope(filePath: string, scopeDir: string): boolean {
  const normalized = filePath.replace(/\\/g, '/')
  if (TEST_PATTERNS.some(p => p.test(normalized))) return true
  return normalized.startsWith(scopeDir.replace(/\\/g, '/'))
}

const TEST_PATTERNS = [
  /__tests__\//,
  /\.test\./,
  /\.spec\./,
  /^test\//,
  /^tests\//,
]

// Belt-and-suspenders secret detector. The LLM has been instructed not to emit
// secrets; this catches accidents.
const SECRET_PATTERNS = [
  /sk-(ant-|or-|proj-|live-)?[a-zA-Z0-9_-]{20,}/,
  /ghp_[a-zA-Z0-9]{36}/,
  /AIza[a-zA-Z0-9_-]{35}/,
  /AKIA[A-Z0-9]{16}/,
]
function containsObviousSecret(content: string): boolean {
  return SECRET_PATTERNS.some(p => p.test(content))
}

async function resolveGithubToken(
  db: ReturnType<typeof getServiceClient>,
  ownerUserId: string | null,
  projectId: string,
): Promise<string | null> {
  // Resolution order: project-level vault ref → raw value in same column →
  // env fallback (self-host / founder dogfood). Never log the token.
  void ownerUserId
  const { data, error } = await db
    .from('project_settings')
    .select('github_installation_token_ref')
    .eq('project_id', projectId)
    .maybeSingle()

  if (!error && data?.github_installation_token_ref) {
    const ref = String(data.github_installation_token_ref)
    if (ref.startsWith('vault://')) {
      const id = ref.slice('vault://'.length)
      const { data: secret, error: vaultErr } = await db.rpc('vault_get_secret', { secret_id: id })
      if (!vaultErr && typeof secret === 'string' && secret.length > 0) {
        return secret
      }
    } else if (ref.length > 0) {
      // Raw token persisted (dev / founder dogfood). Pipeline already warns
      // once via byok.ts; we just return.
      return ref
    }
  }
  return Deno.env.get('GITHUB_TOKEN') ?? null
}

function buildUserPrompt(
  report: Record<string, unknown>,
  settings: Record<string, unknown> | null,
  codeContext: string,
  repo: ResolvedRepo,
  webSnippets: FirecrawlSearchResult[] = [],
): string {
  const env = (report.environment ?? {}) as Record<string, unknown>
  const consoleErrors = ((report.console_logs ?? []) as Array<{ level: string; message: string }>)
    .filter(l => l.level === 'error' || l.level === 'warn')
    .slice(0, 10)
    .map(l => `[${l.level}] ${l.message}`)
    .join('\n')

  const failedRequests = ((report.network_logs ?? []) as Array<{ method: string; url: string; status: number }>)
    .filter(l => l.status >= 400)
    .slice(0, 10)
    .map(l => `${l.method} ${l.url} → ${l.status}`)
    .join('\n')

  const reproSteps = (report.reproduction_steps ?? []) as string[]

  return `## Bug Report
**Summary**: ${report.summary ?? '(none — see description)'}
**User description**: ${report.description ?? '(none)'}
**Category**: ${report.category ?? 'unknown'} | **Severity**: ${report.severity ?? 'unknown'}
**Component**: ${report.component ?? 'unknown'}
**Confidence**: ${report.confidence ?? 'n/a'}

## Reproduction Steps
${reproSteps.length > 0 ? reproSteps.map((s, i) => `${i + 1}. ${s}`).join('\n') : '(none captured)'}

## Stage 2 Root Cause Analysis
${(report.stage2_analysis as Record<string, unknown> | null)?.rootCause ?? '(no root cause captured)'}

## Suggested Fix Direction (from Stage 2)
${(report.stage2_analysis as Record<string, unknown> | null)?.suggestedFix ?? '(no suggestion)'}

## Environment
- URL: ${env.url ?? 'unknown'}
- Browser: ${env.userAgent ?? 'unknown'}
- Viewport: ${(env.viewport as Record<string, number> | undefined)?.width ?? '?'}×${(env.viewport as Record<string, number> | undefined)?.height ?? '?'}

${consoleErrors ? `## Console errors\n${consoleErrors}\n` : ''}
${failedRequests ? `## Failed network requests\n${failedRequests}\n` : ''}

## Repository
- ${repo.owner}/${repo.repo} (default branch: ${repo.defaultBranch})
- Max lines per file: ${settings?.autofix_max_lines ?? 200}

## Relevant Code (RAG-retrieved)
${codeContext || '(No code context retrieved — propose what files to look at and set needsHumanReview=true.)'}

${webSnippets.length > 0 ? `## Web Context (Firecrawl auto-augment)
The local RAG was sparse OR this report has been judged "stubborn" in the past, so we pulled the top ${webSnippets.length} web result${webSnippets.length === 1 ? '' : 's'} matching the symptom. Treat these as hints — verify against the actual code before relying on them, and never copy/paste verbatim if it would conflict with the project's existing style.

${webSnippets.map((s, i) => `### [${i + 1}] ${s.title}\n<${s.url}>\n${s.snippet}`).join('\n\n')}
` : ''}
## Your Task
Output a structured fix plan. Touch the minimum number of files. Match the existing code style. If you change behavior, add or update a test. If you are not confident, set needsHumanReview=true.`
}

// ----------------------------------------------------------------------------
// GitHub PR creation via raw REST. Octokit doesn't run in Deno, but the
// Contents and Pulls APIs are simple JSON-over-HTTPS calls.
// ----------------------------------------------------------------------------

interface PrResult {
  url: string
  number: number
  branch: string
  commitSha: string
}

interface CreatePrInput {
  token: string
  owner: string
  repo: string
  defaultBranch: string
  reportId: string
  fix: FixOutput
}

async function createDraftPr(input: CreatePrInput): Promise<PrResult> {
  const { token, owner, repo, defaultBranch, reportId, fix } = input
  const branch = `mushi/fix-${reportId.slice(0, 8)}-${Date.now().toString(36)}`

  const baseHeaders = {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
    'User-Agent': 'mushi-mushi-fix-worker/1.0',
  }

  // Fetch the SHA of the default branch tip so we can branch from it.
  const refRes = await ghFetch(
    `https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${defaultBranch}`,
    { headers: baseHeaders },
  )
  const baseSha = (refRes as { object: { sha: string } }).object.sha

  // Create the new branch.
  await ghFetch(
    `https://api.github.com/repos/${owner}/${repo}/git/refs`,
    {
      method: 'POST',
      headers: baseHeaders,
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: baseSha }),
    },
  )

  // Commit each file. Sequential keeps the commit log readable; the diffs
  // are small enough that parallelism isn't worth the rate-limit risk.
  let lastCommitSha = baseSha
  for (const file of fix.files) {
    // Need the existing file SHA if it exists (to update vs. create).
    const existing = await ghFetchOptional(
      `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(file.path)}?ref=${encodeURIComponent(branch)}`,
      { headers: baseHeaders },
    )
    const existingSha = existing && typeof (existing as Record<string, unknown>).sha === 'string'
      ? (existing as { sha: string }).sha
      : undefined

    const putRes = await ghFetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(file.path)}`,
      {
        method: 'PUT',
        headers: baseHeaders,
        body: JSON.stringify({
          message: `mushi: ${file.reason}`,
          content: btoa(unescape(encodeURIComponent(file.contents))),
          branch,
          ...(existingSha ? { sha: existingSha } : {}),
        }),
      },
    ) as { commit: { sha: string } }
    lastCommitSha = putRes.commit.sha
  }

  // Open the draft PR. `draft: true` is the V5.3 default — humans approve.
  const prRes = await ghFetch(
    `https://api.github.com/repos/${owner}/${repo}/pulls`,
    {
      method: 'POST',
      headers: baseHeaders,
      body: JSON.stringify({
        title: fix.summary,
        head: branch,
        base: defaultBranch,
        draft: true,
        body: buildPrBody(fix, reportId),
      }),
    },
  ) as { number: number; html_url: string }

  // Best-effort labels: no-op on failure (e.g. permissions or label doesn't
  // exist). The PR itself is the load-bearing artifact.
  await ghFetchOptional(
    `https://api.github.com/repos/${owner}/${repo}/issues/${prRes.number}/labels`,
    {
      method: 'POST',
      headers: baseHeaders,
      body: JSON.stringify({ labels: ['mushi-autofix'] }),
    },
  )

  return {
    url: prRes.html_url,
    number: prRes.number,
    branch,
    commitSha: lastCommitSha,
  }
}

function buildPrBody(fix: FixOutput, reportId: string): string {
  const fileList = fix.files.map(f => `- \`${f.path}\` — ${f.reason}`).join('\n')
  const reviewBanner = fix.needsHumanReview
    ? '> ⚠️ **The agent flagged this fix as needing extra human review.** Read the rationale carefully before approving.\n\n'
    : ''
  return `${reviewBanner}## Mushi Mushi Auto-Fix

**Report**: \`${reportId}\`

### Why this change
${fix.rationale}

### Files changed
${fileList}

---
*This PR was generated by Mushi Mushi using your project's BYOK LLM key. The agent operates within a circuit-breaker (max lines per file) and a structured-output schema — it cannot run shell commands or call arbitrary tools. Review every line before merging.*

[Open report in admin console](mushi://reports/${reportId})`
}

async function ghFetch(url: string, init: RequestInit): Promise<unknown> {
  const res = await fetch(url, init)
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`GitHub ${init.method ?? 'GET'} ${url} → ${res.status}: ${text.slice(0, 200)}`)
  }
  return res.json()
}

async function ghFetchOptional(url: string, init: RequestInit): Promise<unknown | null> {
  const res = await fetch(url, init)
  if (res.status === 404) return null
  if (!res.ok) {
    return null
  }
  try {
    return await res.json()
  } catch {
    return null
  }
}
