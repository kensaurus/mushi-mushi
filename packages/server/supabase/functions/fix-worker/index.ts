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
 *   7. Creates a draft PR via direct GitHub REST API, then immediately marks
 *      it ready for review so CI runs and console merge works (human still
 *      confirms merge — nothing auto-merges).
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
 * multi-turn lands in a release.
 */

import { generateObject, NoObjectGeneratedError } from 'npm:ai@4';
import { createAnthropic } from 'npm:@ai-sdk/anthropic@1';
import { createOpenAI } from 'npm:@ai-sdk/openai@1';
import { z } from 'npm:zod@3';
import { getServiceClient } from '../_shared/db.ts';
import { withSentry } from '../_shared/sentry.ts';
import { resolveLlmKey } from '../_shared/byok.ts';
import { withAnthropicOrOpenAi, LlmFailoverError } from '../_shared/llm-failover.ts';
import {
  getRelevantCodeWithReason,
  formatCodeContext,
  type RagSkipReason,
} from '../_shared/rag.ts';
import { createPrFromFiles, generateFixBranchName } from '../_shared/github-pr.ts';

function ragSkipReasonMessage(reason: RagSkipReason | 'ok', detail: string | undefined): string {
  switch (reason) {
    case 'disabled':
      return 'Codebase indexing is disabled. Enable it in Settings → Integrations → GitHub and re-run the fix.';
    case 'empty_query':
      return 'Report lacks a summary/intent/component — cannot build a RAG query. Re-classify the report and retry.';
    case 'embedding_failed':
      return `RAG embedding call failed (${detail ?? 'unknown'}). Check BYOK OpenAI key / base URL or set OPENAI_API_KEY as an env fallback, then retry.`;
    case 'rpc_failed':
      return `match_codebase_files RPC failed (${detail ?? 'unknown'}). Re-run the latest migrations, then retry.`;
    case 'no_matches':
      return 'Codebase is indexed but no file matched this report. Re-index the repo or broaden the report summary, then retry.';
    default:
      return 'Codebase not indexed. Enable in Settings → Integrations → GitHub, or increase MUSHI_FIX_MIN_RAG_CHUNKS if you want to proceed with less context.';
  }
}
import { firecrawlSearch, type FirecrawlSearchResult } from '../_shared/firecrawl.ts';
import { createTrace } from '../_shared/observability.ts';
import { log as rootLog, type Logger } from '../_shared/logger.ts';
import { requireServiceRoleAuth } from '../_shared/auth.ts';
import { FIX_MODEL, FIX_FALLBACK } from '../_shared/models.ts';
import { getPromptForStage } from '../_shared/prompt-ab.ts'
import { checkAutofixBudget } from '../_shared/autofix-budget.ts';
import { dispatchPluginEvent } from '../_shared/plugins.ts';
import { notifyReportStatusTransition } from '../_shared/report-status-notify.ts';

// ----------------------------------------------------------------------------
// Structured fix output lives in `_shared/fix-schema.ts` so the regression
// tests can import the schema without dragging in the Edge runtime's `npm:`
// specifiers. See that file for the MUSHI-MUSHI-SERVER-J/8 placeholder-rejection
// rationale.
// ----------------------------------------------------------------------------

import { fixSchema, type FixOutput } from '../_shared/fix-schema.ts';
import { validateEdgeSpec, renderSpecContextEdge } from '../_shared/spec-validation.ts';

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
8. Stay within the configured scope directory unless adding tests.

NEVER emit placeholder output. The strings "placeholder", "TODO", "lorem ipsum", "FIXME", "...", or any stub stand-in for real content are FORBIDDEN as the value of \`summary\`, \`rationale\`, \`files[].contents\`, or \`files[].reason\`. The schema will reject them and you will be retried. If you do not have enough context to write a real fix:
  - set \`needsHumanReview: true\`
  - in \`rationale\`, explain exactly which file or snippet you would need to see
  - in \`files\`, you MUST include at least one file — emit the SMALLEST plausible defensive change you can justify (e.g. an explicit error message at the crash site, a null-guard, or a TODO comment that references the specific line that needs investigation). A \`NEEDS_INVESTIGATION.md\` with a concrete analysis of what you found and what needs to change is acceptable.
  - \`files\` can NEVER be an empty array — the schema requires at least one entry
  - never emit a draft PR full of stub files just to satisfy the schema`;

interface FixRequestBody {
  dispatchId: string;
}

interface ResolvedRepo {
  owner: string;
  repo: string;
  defaultBranch: string;
  scopeDirectory?: string;
}

/**
 * Inventory anchor recovered from the bidirectional graph at dispatch time.
 * The Edge fix-worker's twin of `FixContext.inventoryAction` in
 * `@mushi-mushi/agents` — kept structurally compatible so the docs / admin
 * UI / future Node-side judge can treat them as one shape.
 *
 * `expected_outcome` is the customer's machine-readable success contract
 * (whitepaper §2.10 spec-traceability). When present, the LLM prompt
 * embeds every assertion verbatim so the draft fix has an explicit target,
 * not just "an absence of the bug."
 */
interface InventoryAnchor {
  actionNodeId: string;
  actionLabel: string;
  actionDescription?: string;
  pagePath?: string;
  pageId?: string;
  storyId?: string;
  storyTitle?: string;
  expectedOutcome?: Record<string, unknown> | null;
}

Deno.serve(
  withSentry('fix-worker', async (req) => {
    // SEC-1: Internal-only — invoked by the `api` function after a user
    // dispatches a fix. `verify_jwt = false` in config.toml; we require the
    // service-role key that `api` already sends. Without this guard an
    // attacker could trigger arbitrary fix-worker runs (PR creation, LLM
    // calls billed to the project).
    const unauthorized = requireServiceRoleAuth(req);
    if (unauthorized) return unauthorized;

    const log = rootLog.child('fix-worker');
    const requestId = req.headers.get('x-request-id')?.trim();
    let body: FixRequestBody;
    try {
      const raw: unknown = await req.json();
      if (
        !raw ||
        typeof raw !== 'object' ||
        typeof (raw as { dispatchId?: unknown }).dispatchId !== 'string'
      ) {
        return new Response(JSON.stringify({ ok: false, error: 'dispatchId required' }), {
          status: 400,
        });
      }
      body = { dispatchId: (raw as { dispatchId: string }).dispatchId };
    } catch {
      return new Response(JSON.stringify({ ok: false, error: 'Body must be JSON' }), {
        status: 400,
      });
    }

    log.info('job.start', { dispatchId: body.dispatchId, requestId });

    const db = getServiceClient();

    // ---- 1. Mark dispatch as running -----------------------------------------
    const { data: dispatch, error: dispatchErr } = await db
      .from('fix_dispatch_jobs')
      .update({ status: 'running', started_at: new Date().toISOString() })
      .eq('id', body.dispatchId)
      .eq('status', 'queued')
      .select(
        'id, project_id, report_id, requested_by, inventory_action_node_id, coordination_id, dispatch_metadata',
      )
      .single();

    if (dispatchErr || !dispatch) {
      log.warn('Dispatch not found or not in queued state', {
        dispatchId: body.dispatchId,
        err: dispatchErr?.message,
      });
      return new Response(JSON.stringify({ ok: false, error: 'Dispatch not in queued state' }), {
        status: 409,
      });
    }

    const trace = createTrace('fix-worker', {
      dispatchId: dispatch.id,
      projectId: dispatch.project_id,
      reportId: dispatch.report_id,
    });

    // ---- 2. Resolve requested agent + insert fix_attempts row ----------------
    // V5.3 §2.10: the fix-worker is the REST/LLM dispatch path (one of the
    // three agent shapes the orchestrator knows about). Historically this
    // row was hardcoded `agent:'llm'`, which meant the Fixes page and the
    // judge both lost track of what the user *asked* for vs. what ran.
    // Thread settings.autofix_agent through so the receipt is honest.
    const { data: requestedSettings } = await db
      .from('project_settings')
      .select('autofix_agent')
      .eq('project_id', dispatch.project_id)
      .single();
    const requestedAgent = (requestedSettings?.autofix_agent as string | null) ?? 'claude_code';

    // Agents the fix-worker can actually execute today. 'claude_code' is the
    // migration default and maps to the LLM path (Anthropic primary, OpenAI
    // fallback) — the MCP-hosted Claude Code shell lives in @mushi-mushi/agents
    // and isn't reachable from Deno edge yet. 'rest_fix_worker' is the
    // explicit opt-in for this same path. Anything else is the Node-only
    // orchestrator territory and must be rejected rather than silently
    // falling through.
    const SUPPORTED_AGENTS = new Set(['claude_code', 'rest_fix_worker', 'llm']);

    // Spec-traceability (whitepaper §2.10): recover the inventory anchor.
    // classify-report writes a `reports_against` graph edge from the report
    // to its picked Action node. The dispatch row may already carry a hint
    // (caller-supplied override) — prefer that when present, otherwise walk
    // the graph. Soft fail: legacy reports / projects without v2 just get
    // an undefined anchor and the legacy fix prompt runs unchanged.
    const inventoryAnchor = await loadInventoryAnchor(
      db,
      dispatch.project_id,
      dispatch.report_id,
      dispatch.inventory_action_node_id ?? null,
    );
    if (inventoryAnchor && !dispatch.inventory_action_node_id) {
      // Mirror the recovered id back onto the dispatch row so admin queries
      // ("show me dispatches for this Action") work without a graph walk.
      await db
        .from('fix_dispatch_jobs')
        .update({ inventory_action_node_id: inventoryAnchor.actionNodeId })
        .eq('id', dispatch.id)
        .then(
          () => undefined,
          () => undefined,
        );
    }

    const { data: attempt, error: attemptErr } = await db
      .from('fix_attempts')
      .insert({
        report_id: dispatch.report_id,
        project_id: dispatch.project_id,
        agent: requestedAgent,
        status: 'running',
        langfuse_trace_id: trace.id,
        // Spec-traceability: stamp the anchor on the attempt at insert time
        // so the admin "Fixes for this Action" filter is a single index hit
        // instead of a graph walk per page render.
        inventory_action_node_id: inventoryAnchor?.actionNodeId ?? null,
      })
      .select('id')
      .single();

    if (attemptErr || !attempt) {
      await failDispatch(db, dispatch.id, `fix_attempts insert failed: ${attemptErr?.message}`);
      return new Response(JSON.stringify({ ok: false, error: attemptErr?.message }), {
        status: 500,
      });
    }
    const fixAttemptId = attempt.id;

    await db
      .from('fix_dispatch_jobs')
      .update({ fix_attempt_id: fixAttemptId })
      .eq('id', dispatch.id);

    try {
      // ---- 3. Load report, settings, RAG context -----------------------------
      // Wave S (2026-04-23, PERF): narrow `select('*')` to the columns we
      // actually touch. `reports` carries a fat `stage2_analysis` jsonb,
      // dozens of attribute columns, embedding vectors, and audit fields —
      // pulling all of them over the wire cost ~50 KB per dispatch. Same
      // for `project_settings` (BYOK blobs, Slack tokens, PR template).
      // The explicit column list doubles as documentation of what the
      // fix-worker actually depends on — drift between handler code and
      // schema becomes a type error instead of a silent correctness risk.
      const ctxSpan = trace.span('context.assemble');
      const [{ data: _reportRaw }, { data: _settingsRaw }, { data: project }] = await Promise.all([
        db
          .from('reports')
          .select(
            'id, description, summary, category, severity, component, confidence, user_intent, status, reporter_token_hash, ' +
              'stage2_analysis, reproduction_steps, environment, console_logs, network_logs, ' +
              'judge_score',
          )
          .eq('id', dispatch.report_id)
          .single(),
        db
          .from('project_settings')
          .select(
            'project_id, autofix_agent, autofix_max_lines, sandbox_provider, ' +
              'github_repo_url, codebase_repo_url, fix_branch_template, ' +
              'autofix_max_spend_usd, autofix_max_dispatches_per_day, autofix_approval_cost_threshold_usd',
          )
          .eq('project_id', dispatch.project_id)
          .single(),
        db.from('projects').select('id, name, owner_id').eq('id', dispatch.project_id).single(),
      ]);
      const report = _reportRaw as unknown as Record<string, unknown> | null;
      const settings = _settingsRaw as unknown as Record<string, unknown> | null;

      if (!report) throw new Error(`Report ${dispatch.report_id} not found`);
      if (!project) throw new Error(`Project ${dispatch.project_id} not found`);

      const budget = await checkAutofixBudget(db, dispatch.project_id, {
        autofix_max_spend_usd: (settings?.autofix_max_spend_usd as number | null) ?? null,
        autofix_max_dispatches_per_day: (settings?.autofix_max_dispatches_per_day as number | null) ?? null,
        autofix_approval_cost_threshold_usd:
          (settings?.autofix_approval_cost_threshold_usd as number | null) ?? null,
      }, { severity: report.severity as string | null, estimatedCostUsd: 0.25 });

      if (!budget.allowed) {
        await completeAttempt(db, fixAttemptId, {
          status: 'failed',
          error: budget.reason ?? 'Auto-fix budget exceeded',
          files_changed: [],
        });
        await db.from('fix_dispatch_jobs').update({
          status: 'skipped',
          error: budget.reason,
          finished_at: new Date().toISOString(),
        }).eq('id', dispatch.id);
        await trace.end();
        return new Response(JSON.stringify({ ok: true, skipped: true, reason: budget.reason }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // `fix_dispatch_jobs` has no `approved` column — the approval signal is
      // stored in the `dispatch_metadata` JSONB (set by the console approve action).
      const dispatchApproved =
        ((dispatch.dispatch_metadata as Record<string, unknown> | null) ?? {}).approved === true;
      if (budget.requiresApproval && !dispatchApproved) {
        const approvalReason =
          'Estimated dispatch cost exceeds approval threshold — approve in console before PR creation.';
        await db.from('fix_dispatch_jobs').update({
          status: 'skipped',
          error: approvalReason,
          finished_at: new Date().toISOString(),
        }).eq('id', dispatch.id);
        await trace.end();
        return new Response(JSON.stringify({ ok: true, skipped: true, awaiting_approval: true, reason: approvalReason }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Agent pre-flight: fix-worker can only run the LLM path today. Any
      // other autofix_agent (mcp, generic_mcp, codex) needs the Node-side
      // orchestrator — fail fast with an actionable error instead of
      // silently running the LLM and mislabeling the receipt.
      if (!SUPPORTED_AGENTS.has(requestedAgent)) {
        const reason =
          `autofix_agent='${requestedAgent}' isn't supported by the edge fix-worker yet. ` +
          `Change Settings → Integrations → Auto-fix agent to 'claude_code' (default), ` +
          `or run the Node-side orchestrator in @mushi-mushi/agents.`;
        log.warn('Fix skipped: unsupported agent', {
          reportId: dispatch.report_id,
          requestedAgent,
        });
        await completeAttempt(db, fixAttemptId, {
          status: 'skipped_unsupported_agent',
          error: reason,
          files_changed: [],
        });
        const { error: skipUpdateErr } = await db
          .from('fix_dispatch_jobs')
          .update({
            status: 'skipped',
            error: reason,
            finished_at: new Date().toISOString(),
          })
          .eq('id', dispatch.id);
        if (skipUpdateErr) {
          // The dispatch was claimed (status='running') in step 1. If we
          // can't transition it to 'skipped', it will be stuck for the next
          // poller. Fall back to failDispatch so the row is at least moved
          // out of 'running'.
          log.error('Failed to persist skipped dispatch — falling back to failDispatch', {
            dispatchId: dispatch.id,
            updateErr: skipUpdateErr.message,
          });
          await failDispatch(db, dispatch.id, `skip persist failed: ${skipUpdateErr.message}`);
          await trace.end();
          return new Response(
            JSON.stringify({ ok: false, error: 'Failed to persist skipped state' }),
            { status: 500, headers: { 'Content-Type': 'application/json' } },
          );
        }
        await trace.end();
        return new Response(JSON.stringify({ ok: true, skipped: true, reason, fixAttemptId }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Sandbox pre-flight (V5.3 §2.10): the orchestrator gate lives in
      // packages/agents but the fix-worker is a parallel code path that
      // ships today. Mirror the policy here so production dispatches never
      // land on a no-op sandbox by accident. Non-production and explicit
      // opt-in (MUSHI_ALLOW_LOCAL_SANDBOX=1) both bypass the gate.
      const sandboxProvider = (settings?.sandbox_provider as string | null) ?? 'local-noop';
      const denoEnv = Deno.env.get('SUPABASE_ENV') ?? Deno.env.get('DENO_ENV') ?? 'production';
      const allowLocalSandbox = Deno.env.get('MUSHI_ALLOW_LOCAL_SANDBOX') === '1';
      if (sandboxProvider === 'local-noop' && denoEnv === 'production' && !allowLocalSandbox) {
        const reason =
          'Sandbox provider is set to local-noop which is not allowed in ' +
          'production. Switch Settings → Integrations → Sandbox to e2b/modal/' +
          'cloudflare, or set MUSHI_ALLOW_LOCAL_SANDBOX=1 for CI/dry-run.';
        log.warn('Fix skipped: sandbox policy violation', {
          reportId: dispatch.report_id,
          sandboxProvider,
          env: denoEnv,
        });
        await completeAttempt(db, fixAttemptId, {
          status: 'skipped_no_sandbox',
          error: reason,
          files_changed: [],
        });
        await db
          .from('fix_dispatch_jobs')
          .update({
            status: 'skipped',
            error: reason,
            finished_at: new Date().toISOString(),
          })
          .eq('id', dispatch.id);
        await trace.end();
        return new Response(JSON.stringify({ ok: true, skipped: true, reason, fixAttemptId }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Multi-repo: when this dispatch was fanned out by a sibling
      // attempt's `markCrossRepoSpan()` it carries a target_repo_id
      // hint in `dispatch_metadata`. Honor it so we run the fix against
      // the matching repo's URL + scope, not the project primary.
      const dispatchMeta = (dispatch.dispatch_metadata as Record<string, unknown> | null) ?? {};
      const targetRepoId = typeof dispatchMeta.target_repo_id === 'string' ? dispatchMeta.target_repo_id : null;
      const repo = await resolveRepo(db, dispatch.project_id, settings, targetRepoId);
      if (!repo) {
        throw new Error(
          'No GitHub repo configured for this project. Set Settings → Integrations → GitHub repo.',
        );
      }

      const ragSpan = trace.span('context.rag');
      const ragResult = await getRelevantCodeWithReason(db, dispatch.project_id, {
        symptom: (report.summary as string | undefined) ?? (report.description as string | undefined)?.slice(0, 200) ?? '',
        action: (report.user_intent as string | undefined) ?? '',
        component: (report.component as string | undefined) ?? '',
      });
      const codeFiles = ragResult.files;
      ragSpan.end({
        fileCount: codeFiles.length,
        reason: ragResult.reason,
        detail: ragResult.detail ?? null,
      });

      const MIN_RAG_CHUNKS = Math.max(
        0,
        Number(Deno.env.get('MUSHI_FIX_MIN_RAG_CHUNKS') ?? '1') | 0,
      );
      if (codeFiles.length < MIN_RAG_CHUNKS) {
        log.warn('RAG context below minimum threshold', {
          reportId: dispatch.report_id,
          codeFiles: codeFiles.length,
          threshold: MIN_RAG_CHUNKS,
        });
      }

      const codeContext = formatCodeContext(codeFiles);

      // Loop-closure: pull "past similar merged fixes" via the fix_corpus
      // RPC. This is the second retrieval signal — `match_codebase_files`
      // tells us "where in the code the bug probably lives", and
      // `match_fix_corpus` tells us "what diffs have worked for similar
      // bugs in this project's past". The latter is gold for in-context
      // learning: the model sees a real, validated diff for a real,
      // validated bug instead of having to reason from first principles.
      //
      // Best-effort: a failed corpus call must NOT block the fix. We
      // swallow + log; the model still gets the source-chunk context.
      const pastFixesSpan = trace.span('context.past-fixes');
      let pastFixesContext = '';
      try {
        const queryText = [
          report.summary as string | undefined,
          (report.user_intent as string | undefined) ?? undefined,
          (report.component as string | undefined) ?? undefined,
        ]
          .filter((s) => typeof s === 'string' && s.trim().length > 0)
          .join(' ');
        if (queryText.trim().length > 0) {
          const { createEmbedding } = await import('../_shared/embeddings.ts');
          const queryEmbedding = await createEmbedding(queryText, {
            projectId: dispatch.project_id,
          });
          const { data: pastFixes } = await db.rpc('match_fix_corpus', {
            query_embedding: queryEmbedding,
            match_project: dispatch.project_id,
            match_count: 3,
          });
          const matched = (pastFixes ?? []) as Array<{
            id: string;
            bug_summary: string;
            fix_summary: string;
            rationale: string | null;
            files_changed: string[] | null;
            similarity: number;
          }>;
          // Floor at 0.55 — anything below is effectively unrelated and
          // the model treats it as noise, often anchoring on the wrong
          // file. Tuned against glot.it's first 30 indexed fixes.
          const relevant = matched.filter((m) => m.similarity >= 0.55);
          if (relevant.length > 0) {
            pastFixesContext = relevant
              .map(
                (m, i) =>
                  `### Past fix ${i + 1} (similarity ${m.similarity.toFixed(2)})
- Bug: ${m.bug_summary}
- Fix: ${m.fix_summary}
${m.rationale ? `- Rationale: ${m.rationale.slice(0, 600)}` : ''}
${
  Array.isArray(m.files_changed) && m.files_changed.length > 0
    ? `- Files touched: ${m.files_changed.slice(0, 10).join(', ')}`
    : ''
}`,
              )
              .join('\n\n');
          }
          pastFixesSpan.end({ matched: matched.length, used: relevant.length });
        } else {
          pastFixesSpan.end({ matched: 0, used: 0, reason: 'empty_query' });
        }
      } catch (err) {
        log.warn('fix_corpus retrieval failed (non-fatal)', {
          reportId: dispatch.report_id,
          err: err instanceof Error ? err.message : String(err),
        });
        pastFixesSpan.end({ error: String(err).slice(0, 200) });
      }

      ctxSpan.end({ codeFileCount: codeFiles.length, repo: `${repo.owner}/${repo.repo}` });

      // ---- 3b. Firecrawl auto-augment when local RAG is sparse OR
      //          the report has a poor prior judge score (a "stubborn" report).
      //          The whole block is best-effort: if Firecrawl is missing the key,
      //          rate-limited, or otherwise unhappy, the worker proceeds with
      //          local-only context. We persist the trace id + URLs onto
      //          fix_attempts so the Fixes page shows what the agent saw.
      const judgeScore = typeof report.judge_score === 'number' ? report.judge_score : null;
      const augmentReason: 'rag_sparse' | 'low_judge_score' | null =
        codeFiles.length < 3
          ? 'rag_sparse'
          : judgeScore !== null && judgeScore < 0.6
            ? 'low_judge_score'
            : null;

      let webSnippets: FirecrawlSearchResult[] = [];
      let augmentTraceId: string | null = null;
      if (augmentReason) {
        try {
          const symptom =
            (report.summary as string | undefined) ?? (report.description as string | undefined)?.slice(0, 200) ?? (report.component as string | undefined) ?? '';
          if (symptom.length > 0) {
            const augSpan = trace.span('fix.augment.firecrawl');
            webSnippets = await firecrawlSearch(db, dispatch.project_id, symptom, { limit: 3 });
            augSpan.end({ resultCount: webSnippets.length });
            if (webSnippets.length > 0) {
              augmentTraceId = trace.id;
              await db
                .from('fix_attempts')
                .update({
                  augment_trace_id: augmentTraceId,
                  augment_sources: webSnippets.map((s) => ({
                    url: s.url,
                    title: s.title,
                    snippet: s.snippet.slice(0, 240),
                  })),
                  augment_reason: augmentReason,
                })
                .eq('id', fixAttemptId);
            }
          }
        } catch (err) {
          // FIRECRAWL_NOT_CONFIGURED is expected on most projects — silent.
          // Other errors get logged but never fail the fix.
          const msg = err instanceof Error ? err.message : String(err);
          if (msg !== 'FIRECRAWL_NOT_CONFIGURED') {
            log.warn('Firecrawl augment failed (non-fatal)', {
              reportId: dispatch.report_id,
              reason: augmentReason,
              error: msg,
            });
          }
        }
      }

      // ---- 3c. Context floor gate -------------------------------------------
      // If BOTH the codebase RAG and the Firecrawl augment produced nothing,
      // we have no grounding for the LLM — calling it anyway produces a
      // "INVESTIGATION_NEEDED.md" stub PR (exactly what landed on glot.it
      // PRs #3/#4/#5). Short-circuit instead of burning a model call, and
      // surface the reason on the PDCA receipt so the user can act.
      if (codeFiles.length < MIN_RAG_CHUNKS && webSnippets.length === 0) {
        const reason = ragSkipReasonMessage(ragResult.reason, ragResult.detail);
        log.warn('Fix skipped: no grounding context available', {
          reportId: dispatch.report_id,
          codeFiles: codeFiles.length,
          webSnippets: webSnippets.length,
          minRagChunks: MIN_RAG_CHUNKS,
          ragReason: ragResult.reason,
          ragDetail: ragResult.detail ?? null,
        });
        await completeAttempt(db, fixAttemptId, {
          status: 'skipped_no_context',
          error: reason,
          files_changed: [],
          failure_category: 'no_relevant_code',
        });
        await db
          .from('fix_dispatch_jobs')
          .update({
            status: 'skipped',
            error: reason,
            finished_at: new Date().toISOString(),
          })
          .eq('id', dispatch.id);
        await trace.end();
        return new Response(JSON.stringify({ ok: true, skipped: true, reason, fixAttemptId }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // ---- 4. Resolve LLM key (BYOK first with multi-key failover) ----------
      // withAnthropicOrOpenAi tries the full Anthropic key pool first, then
      // falls back to the OpenAI pool. Quota/auth failures mark the exhausted
      // key and advance to the next one automatically (Phase 0 multi-key pool).

      const userPrompt = buildUserPrompt(
        report,
        settings,
        codeContext,
        repo,
        webSnippets,
        inventoryAnchor,
        pastFixesContext,
      );

      // Resolve the fix-worker system prompt from `prompt_versions` (stage='fix').
      // Falls back to the hardcoded SYSTEM_PROMPT when no global or project row
      // exists (first boot before migration 20260422110000 runs, or when the
      // operator has deleted every fix-stage row). Wired here so operators can
      // A/B rewrite the senior-engineer rubric without redeploying.
      const fixPromptSelection = await getPromptForStage(db, dispatch.project_id, 'fix');
      const activeFixSystemPrompt = fixPromptSelection.promptTemplate ?? SYSTEM_PROMPT;
      const fixPromptVersion = fixPromptSelection.promptVersion;

      // ---- 5. Call LLM with structured output (multi-key failover) ----------
      const llmSpan = trace.span('llm.fix');
      const llmStart = Date.now();
      let fix: FixOutput | undefined;
      let usedModel = '';
      let inputTokens = 0;
      let outputTokens = 0;

      const DEFAULT_ANTHROPIC_MODEL = FIX_MODEL;
      const DEFAULT_OPENAI_MODEL = `openai/${FIX_FALLBACK}`;

      const MAX_OUTPUT_RETRIES = 2;
      let lastLlmErr: unknown = null;
      for (let attempt = 0; attempt <= MAX_OUTPUT_RETRIES; attempt++) {
        try {
          const { result, usedProvider } = await withAnthropicOrOpenAi(
          db,
          dispatch.project_id,
          async (anthropicResolved) => {
            usedModel = DEFAULT_ANTHROPIC_MODEL;
            const anthropic = createAnthropic({ apiKey: anthropicResolved.key });
            const { object, usage } = await generateObject({
              model: anthropic(usedModel),
              schema: fixSchema,
              temperature: 0,
              messages: [
                {
                  role: 'system',
                  content: activeFixSystemPrompt,
                  experimental_providerMetadata: {
                    anthropic: { cacheControl: { type: 'ephemeral' } },
                  },
                },
                { role: 'user', content: userPrompt },
              ],
              maxTokens: 8_000,
            });
            inputTokens = usage?.promptTokens ?? 0;
            outputTokens = usage?.completionTokens ?? 0;
            return object;
          },
          async (openaiResolved) => {
            const openaiKey = openaiResolved.key;
            const openaiBaseUrl = openaiResolved.baseUrl;
            const isOpenRouter = openaiBaseUrl?.includes('openrouter.ai') ?? false;
            usedModel = isOpenRouter ? DEFAULT_OPENAI_MODEL : FIX_FALLBACK;
            const openai = createOpenAI({
              apiKey: openaiKey,
              ...(openaiBaseUrl ? { baseURL: openaiBaseUrl } : {}),
            });
            const { object, usage } = await generateObject({
              model: openai(usedModel),
              schema: fixSchema,
              temperature: 0,
              system: activeFixSystemPrompt,
              prompt: userPrompt,
              maxTokens: 8_000,
            });
            inputTokens = usage?.promptTokens ?? 0;
            outputTokens = usage?.completionTokens ?? 0;
            return object;
          },
        );
        fix = result;
        void usedProvider; // logged via usedModel
        lastLlmErr = null;
        break;
        } catch (llmErr) {
          lastLlmErr = llmErr;
          if (NoObjectGeneratedError.isInstance(llmErr) && attempt < MAX_OUTPUT_RETRIES) {
            log.warn('Fix worker output validation failed — retrying', { attempt: attempt + 1 });
            continue;
          }
          if (llmErr instanceof LlmFailoverError) {
            llmSpan.end({ error: llmErr.message });
            throw new Error(`LLM call failed: ${llmErr.message}`);
          }
          if (NoObjectGeneratedError.isInstance(llmErr)) {
            const cause = llmErr.cause as
              | { issues?: Array<{ path: (string | number)[]; message: string; code?: string }> }
              | undefined;
            log.warn('Fix worker structured-output schema violation', {
              dispatchId: dispatch.id,
              model: usedModel,
              modelResponse: (llmErr as { text?: string }).text?.slice(0, 800) ?? null,
              zodIssues:
                cause?.issues?.slice(0, 5).map((i) => ({
                  path: i.path.join('.'),
                  code: i.code,
                  message: i.message,
                })) ?? null,
            });
          }
          llmSpan.end({ error: String(llmErr).slice(0, 500) });
          throw new Error(`LLM call failed: ${String(llmErr).slice(0, 300)}`);
        }
      }
      if (lastLlmErr || !fix) {
        throw new Error(`LLM call failed after ${MAX_OUTPUT_RETRIES + 1} attempts`);
      }
      const llmLatencyMs = Date.now() - llmStart;
      llmSpan.end({ model: usedModel, inputTokens, outputTokens, latencyMs: llmLatencyMs });

      // ---- 6. Validate scope + circuit breaker ------------------------------
      const validationErrors: string[] = [];
      const maxLines = (settings?.autofix_max_lines as number | undefined) ?? 200;
      let totalLines = 0;
      for (const f of fix.files) {
        const lines = f.contents.split('\n').length;
        totalLines += lines;
        if (lines > maxLines) {
          validationErrors.push(`${f.path}: ${lines} lines exceeds circuit breaker (${maxLines}).`);
        }
        if (repo.scopeDirectory && !isFileInScope(f.path, repo.scopeDirectory)) {
          validationErrors.push(`${f.path}: outside scope ${repo.scopeDirectory}.`);
        }
        if (containsObviousSecret(f.contents)) {
          validationErrors.push(`${f.path}: contains a token-shaped string. Refusing to commit.`);
        }
      }

      if (validationErrors.length > 0) {
        throw new Error(`Validation failed: ${validationErrors.join(' ')}`);
      }

      // ---- 6b. Spec-traceability gate (pre-PR) --------------------------------
      // Run the deterministic inventory contract checks before we open a PR.
      // Hard violations (JSON path deletion, etc.) surface as errors on the
      // fix_attempt so reviewers see them inline — they do NOT abort the PR
      // unless the diff is objectively regressive (errors[] non-empty).
      // Soft warnings land in spec_validation_warnings and render as the
      // amber "Spec N" badge in FixCard.
      let specValidationWarnings: Array<{ code: string; message: string; hint?: string }> = [];
      if (inventoryAnchor) {
        const diffText: string | undefined = undefined; // edge runtime: no diff yet at this stage
        const specResult = validateEdgeSpec(inventoryAnchor as unknown as Parameters<typeof validateEdgeSpec>[0], fix.files, diffText);
        if (specResult.errors.length > 0) {
          // Hard violations — the generated fix demonstrably regresses the contract.
          // Persist them as warnings with an ERR_ prefix so reviewers know these
          // are gate failures that MUST be resolved before merging.
          for (const e of specResult.errors) {
            specValidationWarnings.push({ code: `ERR_${e.code}`, message: e.message, hint: e.hint });
          }
        }
        for (const w of specResult.warnings) {
          specValidationWarnings.push(w);
        }
        if (specValidationWarnings.length > 0) {
          await db
            .from('fix_attempts')
            .update({ spec_validation_warnings: specValidationWarnings })
            .eq('id', fixAttemptId)
            .then(() => undefined, () => undefined);
        }
      }

      // ---- 7. Get GitHub token + open draft PR ------------------------------
      const ghToken = await resolveGithubToken(db, project.owner_id ?? null, dispatch.project_id);
      if (!ghToken) {
        // Still record the LLM output so the user can copy/paste even without GH.
        const branch = generateFixBranchName(
          dispatch.report_id,
          (settings as Record<string, unknown> | null)?.fix_branch_template as string | null,
          (report as Record<string, unknown> | null)?.category as string | null,
        );
        await completeAttempt(db, fixAttemptId, {
          status: 'completed',
          branch,
          files_changed: fix.files.map((f) => f.path),
          lines_changed: totalLines,
          summary: fix.summary,
          rationale: fix.rationale,
          llm_model: usedModel,
          llm_input_tokens: inputTokens,
          llm_output_tokens: outputTokens,
          review_passed: !fix.needsHumanReview,
        });
        await db
          .from('fix_dispatch_jobs')
          .update({
            // Use a distinct terminal status so the UI can distinguish "fix
            // generated but blocked by missing GitHub App" from a genuine
            // success. The frontend maps this to an amber "setup required"
            // state rather than a green check.
            status: 'completed_no_pr',
            finished_at: new Date().toISOString(),
            error:
              'No GitHub App installed — fix generated but not pushed. Install the GitHub App in Repo → Connect repo to enable auto-PRs.',
          })
          .eq('id', dispatch.id);
        await trace.end();
        return new Response(JSON.stringify({ ok: true, fixAttemptId, prUrl: null, blockedSetup: true }), {
          status: 200,
        });
      }

      const prSpan = trace.span('github.pr');
      const prBranch = generateFixBranchName(
        dispatch.report_id,
        (settings as Record<string, unknown> | null)?.fix_branch_template as string | null,
        (report as Record<string, unknown> | null)?.category as string | null,
      );
      const prResult = await createPrFromFiles(
        {
          token: ghToken,
          owner: repo.owner,
          repo: repo.repo,
          defaultBranch: repo.defaultBranch,
          branch: prBranch,
          title: fix.summary,
          body: buildPrBody(fix, dispatch.report_id),
          files: fix.files,
          labels: ['mushi-autofix'],
        },
        {
          info: (msg, ctx) => log.info(msg, ctx as Record<string, unknown>),
          warn: (msg, ctx) => log.warn(msg, ctx as Record<string, unknown>),
        },
      );
      prSpan.end({ prUrl: prResult.url });

      // ---- 8. Persist + cleanup --------------------------------------------
      await completeAttempt(db, fixAttemptId, {
        status: 'completed',
        branch: prResult.branch,
        pr_url: prResult.url,
        pr_number: prResult.number,
        commit_sha: prResult.commitSha,
        files_changed: fix.files.map((f) => f.path),
        lines_changed: totalLines,
        summary: fix.summary,
        rationale: fix.rationale,
        llm_model: usedModel,
        llm_input_tokens: inputTokens,
        llm_output_tokens: outputTokens,
        review_passed: !fix.needsHumanReview,
        ...(specValidationWarnings.length > 0
          ? { spec_validation_warnings: specValidationWarnings }
          : {}),
      });

      await db
        .from('fix_dispatch_jobs')
        .update({
          status: 'completed',
          pr_url: prResult.url,
          finished_at: new Date().toISOString(),
        })
        .eq('id', dispatch.id);

      await db
        .from('reports')
        .update({
          fix_branch: prResult.branch,
          fix_pr_url: prResult.url,
          status: 'fixing',
        })
        .eq('id', dispatch.report_id);

      const previousReportStatus =
        typeof (report as Record<string, unknown> | null)?.status === 'string'
          ? ((report as Record<string, unknown>).status as string)
          : null;
      const reporterTokenHash =
        typeof (report as Record<string, unknown> | null)?.reporter_token_hash === 'string'
          ? ((report as Record<string, unknown>).reporter_token_hash as string)
          : null;

      if (reporterTokenHash) {
        void notifyReportStatusTransition(db, {
          projectId: dispatch.project_id,
          reportId: dispatch.report_id,
          reporterTokenHash,
          previousStatus: previousReportStatus,
          newStatus: 'fixing',
        }).catch((e) =>
          log.warn('Reporter notification failed', { reportId: dispatch.report_id, err: String(e) }),
        );
      }

      // Loop-closure: fan out `fix.proposed` to every project plugin so the
      // outbound bridges (plugin-jira, plugin-linear, plugin-github-issues,
      // plugin-slack, etc.) can post the draft PR link back to whatever
      // tracker raised the original ticket. Without this dispatch, the only
      // call site of `fix.proposed` is the manual `PATCH /v1/admin/fixes/:id`
      // endpoint — which the admin UI never invokes — so plugins receive
      // nothing for auto-worker fixes (the 99% path).
      void dispatchPluginEvent(db, dispatch.project_id, 'fix.proposed', {
        report: { id: dispatch.report_id },
        fix: {
          id: fixAttemptId,
          agent: 'mushi-fix-worker',
          branch: prResult.branch,
          prUrl: prResult.url,
          commitSha: prResult.commitSha,
          summary: fix.summary,
        },
      }).catch((e) =>
        log.warn('Plugin dispatch failed', { event: 'fix.proposed', err: String(e) }),
      );

      // Loop-closure (deferred-6): multi-repo coordination. If the project
      // has >1 repos AND the RAG retrieval pulled in code from outside the
      // primary repo's path globs, the fix we just opened is almost
      // certainly incomplete — a frontend-only PR for a bug that also
      // needs a backend change is going to fail CI and confuse the
      // reviewer. We attach a `coordination_id` to this attempt and post
      // a cross-link comment on the PR pointing at the sibling repos that
      // probably need parallel changes. The actual fan-out (one
      // FixOrchestrator per repo) lives in `@mushi-mushi/agents`'s
      // MultiRepoFixOrchestrator and is the next-cluster work; the
      // groundwork here makes that fan-out a *new fix_dispatch_jobs row
      // per matched repo* away. Best-effort — never blocks the success
      // path.
      try {
        await markCrossRepoSpan(db, ghToken, log, {
          projectId: dispatch.project_id,
          reportId: dispatch.report_id,
          fixAttemptId,
          primaryRepo: repo,
          codeFiles,
          prUrl: prResult.url,
          prNumber: prResult.number,
        });
      } catch (err) {
        log.warn('cross-repo span check failed (non-fatal)', {
          fixAttemptId,
          err: err instanceof Error ? err.message : String(err),
        });
      }

      // Spec-traceability: enqueue a targeted post-PR synthetic probe
      // against the action this fix was meant to repair. We write a marker
      // `synthetic_runs` row with status='skipped' so the synthetic-monitor
      // cron picks it up on the next tick and re-runs the full assertion
      // chain against the inventory's expected_outcome contract. Without
      // this, the only verification path is the 15-minute reconciler — far
      // too slow to catch a regression before reviewers merge the PR.
      if (inventoryAnchor?.actionNodeId) {
        await db
          .from('synthetic_runs')
          .insert({
            project_id: dispatch.project_id,
            action_node_id: inventoryAnchor.actionNodeId,
            status: 'skipped',
            error_message: 'queued_post_pr',
            step_results: {
              trigger: 'post_pr',
              fix_attempt_id: fixAttemptId,
              report_id: dispatch.report_id,
              pr_url: prResult.url,
              queued_at: new Date().toISOString(),
            },
          })
          .then(
            () => undefined,
            (err: unknown) => {
              log.warn('post_pr synthetic_runs insert failed (non-fatal)', {
                fixAttemptId,
                err: String(err),
              });
            },
          );
      }

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
        });
        if (usageErr) {
          log.warn('usage_events fixes_attempted insert failed (non-fatal)', {
            err: usageErr.message,
            projectId: dispatch.project_id,
          });
        }
      }

      await trace.end();

      return new Response(
        JSON.stringify({
          ok: true,
          fixAttemptId,
          prUrl: prResult.url,
          branch: prResult.branch,
          langfuseTraceId: trace.id,
        }),
        { status: 200 },
      );
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const failureCategory = categorizeFailure(err, errMsg);
      // MUSHI-MUSHI-SERVER-8: expected guardrail outcomes (the agent produced
      // something we deliberately rejected — out-of-scope file, oversized diff,
      // token-shaped string — or hit a transient quota) are NOT server bugs.
      // They are the PDCA loop working as designed and are already recorded on
      // the fix_attempt + dispatch row and surfaced on the admin Fixes page +
      // the `fix.failed` plugin event below. Logging them via `log.error`
      // re-emits them to Sentry (logger.ts forwards error/fatal), which pages
      // on-call for "Fix worker failed" on every scope_blocked. Log these at
      // `warn` so they stay in structured logs without tripping the Sentry
      // error pipeline; genuine infra failures (GitHub/sandbox/LLM/unknown)
      // still escalate as errors.
      const logFields = {
        dispatchId: dispatch.id,
        err: errMsg,
        failureCategory,
      };
      if (EXPECTED_FAILURE_CATEGORIES.has(failureCategory)) {
        log.warn('Fix worker stopped by guardrail', logFields);
      } else {
        log.error('Fix worker failed', logFields);
      }

      await db
        .from('fix_attempts')
        .update({
          status: 'failed',
          error: errMsg.slice(0, 1000),
          failure_category: failureCategory,
          completed_at: new Date().toISOString(),
        })
        .eq('id', fixAttemptId);

      await failDispatch(db, dispatch.id, errMsg);

      // Loop-closure: notify plugins so triagers see "agent tried and gave
      // up" in Slack/Jira/Sentry rather than the report sitting silently in
      // 'classified' forever. Same rationale as the success-path
      // fix.proposed dispatch above.
      void dispatchPluginEvent(db, dispatch.project_id, 'fix.failed', {
        report: { id: dispatch.report_id },
        fix: {
          id: fixAttemptId,
          agent: 'mushi-fix-worker',
          error: errMsg.slice(0, 500),
          failureCategory,
        },
      }).catch((e) => log.warn('Plugin dispatch failed', { event: 'fix.failed', err: String(e) }));

      await trace.end();

      return new Response(JSON.stringify({ ok: false, error: errMsg.slice(0, 500) }), {
        status: 500,
      });
    }
  }),
);

// ============================================================================
// Helpers
// ============================================================================

/**
 * Failure categories that represent an EXPECTED, recoverable outcome of the
 * PDCA loop rather than a server bug:
 *
 *   - scope_blocked       — the LLM proposed a file outside the repo's
 *                           configured scope; the validation gate caught it.
 *   - validation_rejected — a single file exceeded the circuit-breaker line cap.
 *   - spec_violation      — token-shaped string / inventory-contract violation.
 *   - no_relevant_code    — RAG + Firecrawl produced no grounding context.
 *   - llm_rate_limit      — transient provider quota / 429.
 *
 * Each is already persisted on `fix_attempts.failure_category`, surfaced on the
 * admin Fixes page, and fanned out via the `fix.failed` plugin event. They must
 * NOT be re-emitted as Sentry errors (see the catch block + logger.ts), or the
 * fix-worker pages on-call every time a guardrail does its job
 * (MUSHI-MUSHI-SERVER-8). Anything NOT in this set (github_*, sandbox_*,
 * llm_other_error, context_assembly_failed, unknown, …) is treated as a real
 * failure and still logged at `error` → Sentry.
 */
const EXPECTED_FAILURE_CATEGORIES = new Set<string>([
  'scope_blocked',
  'validation_rejected',
  'spec_violation',
  'no_relevant_code',
  'llm_rate_limit',
  // Model returned unparseable JSON or failed Zod validation (e.g. literal
  // "placeholder" stubs). Guardrail working as designed — not a server bug.
  'llm_no_object',
  'llm_invalid_json',
]);

/**
 * Best-effort mapping from a thrown error to one of the
 * fix_attempts.failure_category enum values. NULL is returned only when no
 * pattern matches — `unknown` is reserved for "we tried and the categorizer
 * didn't recognise it" so the operator can grep for "unknown" in the
 * FixSummaryRow tile and decide whether to expand this list.
 *
 * Pattern order matters: more-specific HTTP / vendor codes are checked
 * before generic substrings ("Validation failed:" before "failed").
 */
function categorizeFailure(err: unknown, msg: string): string {
  const m = (msg || '').toLowerCase();
  // AI-SDK structured-output failures — we throw `LLM call failed: …` and
  // the inner error name is in the message.
  if (m.includes('noobjectgeneratederror') || m.includes('no_object')) return 'llm_no_object';
  if (m.includes('aijsonparseerror') || m.includes('jsonparseerror')) return 'llm_invalid_json';
  if (m.includes('rate limit') || m.includes('rate_limit') || m.includes('429')) return 'llm_rate_limit';
  // Validation gates — thrown by us, not the model.
  if (m.startsWith('validation failed:')) {
    if (m.includes('outside scope')) return 'scope_blocked';
    if (m.includes('exceeds circuit breaker')) return 'validation_rejected';
    if (m.includes('token-shaped')) return 'spec_violation';
    return 'validation_rejected';
  }
  // Spec/inventory checker (validateAgainstSpec).
  if (m.includes('spec violation') || m.includes('inventory contract')) return 'spec_violation';
  // Sandbox lifecycle — these can come from agents/sandbox or claude code adapters.
  if (m.includes('sandbox') && m.includes('timeout')) return 'sandbox_timeout';
  if (m.includes('sandbox')) return 'sandbox_error';
  // GitHub REST surface — every PR-creation path goes through Octokit and
  // throws a `Request failed with status code 4xx` Error.
  if (m.includes('github') || m.includes('octokit') || m.includes('pull_request')) {
    if (m.includes('403')) return 'github_403';
    if (m.includes('404')) return 'github_404';
    if (m.includes('422')) return 'github_422';
    return 'github_other_error';
  }
  // Context-floor gate / RAG.
  if (m.includes('skipped_no_context') || m.includes('no grounding context')) return 'no_relevant_code';
  if (m.includes('context assembly') || m.includes('rag failed')) return 'context_assembly_failed';
  // LLM call failed but we couldn't pattern-match the kind.
  if (m.startsWith('llm call failed') || m.includes('anthropic') || m.includes('openai')) {
    return 'llm_other_error';
  }
  return 'unknown';
}

/**
 * Loop-closure (deferred-6): when a project has multiple repos, detect
 * which OTHER repos the RAG-retrieved code lives in and:
 *
 *   1. Create (or attach to) a `fix_coordinations` row so the admin UI
 *      and the agents-package multi-repo orchestrator can group sibling
 *      attempts.
 *   2. Post a cross-link comment on the PR we just opened with a list
 *      of the sibling repos that probably need parallel changes.
 *   3. Insert a child `fix_dispatch_jobs` row per matched sibling repo
 *      so the worker re-fires for that repo on the next sweeper tick.
 *      The child carries `coordination_id` + a `target_repo_id` hint so
 *      the worker can constrain its scopeDirectory accordingly.
 *
 * Idempotency: skip if the parent attempt already has a `coordination_id`
 * (re-runs of the same dispatch don't multiply child jobs).
 */
async function markCrossRepoSpan(
  db: ReturnType<typeof getServiceClient>,
  ghToken: string,
  log: Logger,
  args: {
    projectId: string;
    reportId: string;
    fixAttemptId: string;
    primaryRepo: ResolvedRepo;
    codeFiles: Array<{ filePath: string }>;
    prUrl: string;
    prNumber: number;
  },
): Promise<void> {
  const { projectId, reportId, fixAttemptId, primaryRepo, codeFiles, prUrl, prNumber } = args;
  if (codeFiles.length === 0) return;

  // Pull every project repo. Single-repo projects bail immediately.
  const { data: allRepos } = await db
    .from('project_repos')
    .select('id, repo_url, default_branch, path_globs, is_primary')
    .eq('project_id', projectId);
  const repos = (allRepos ?? []) as Array<{
    id: string;
    repo_url: string;
    default_branch: string | null;
    path_globs: string[] | null;
    is_primary: boolean;
  }>;
  if (repos.length <= 1) return;

  // Match each RAG file against each repo's path_globs. A file matches a
  // repo when ANY of its globs is a prefix of the file path (we use the
  // simple prefix match the existing scopeDirectory check uses, which
  // matches what the indexer writes).
  const fileMatchByRepo = new Map<string, Set<string>>();
  for (const r of repos) {
    fileMatchByRepo.set(r.id, new Set());
  }
  for (const f of codeFiles) {
    const path = f.filePath.replace(/\\/g, '/');
    for (const r of repos) {
      const globs = r.path_globs ?? [];
      if (globs.length === 0) {
        // No globs configured → treat as "matches everything" only for
        // the primary, otherwise we'd lump every file into every repo.
        if (r.is_primary) fileMatchByRepo.get(r.id)!.add(path);
        continue;
      }
      for (const g of globs) {
        const root = g.replace(/\/\*\*?$/, '').replace(/^\.?\//, '');
        if (root.length === 0 || path.startsWith(root)) {
          fileMatchByRepo.get(r.id)!.add(path);
          break;
        }
      }
    }
  }

  const primaryRepoRow = repos.find((r) => {
    const parsed = parseGithubUrl(r.repo_url);
    return parsed?.owner === primaryRepo.owner && parsed?.repo === primaryRepo.repo;
  });
  const siblings = repos.filter(
    (r) =>
      r.id !== primaryRepoRow?.id &&
      (fileMatchByRepo.get(r.id)?.size ?? 0) > 0,
  );

  if (siblings.length === 0) return;

  // Bail if this attempt is already coordinated (idempotency under
  // webhook re-deliveries / manual retriggers).
  const { data: existingAttempt } = await db
    .from('fix_attempts')
    .select('coordination_id')
    .eq('id', fixAttemptId)
    .maybeSingle();
  if (existingAttempt?.coordination_id) return;

  // Create (or fetch) the coordination row.
  const { data: coord, error: coordErr } = await db
    .from('fix_coordinations')
    .insert({
      project_id: projectId,
      report_id: reportId,
      status: 'in_progress',
      plan: {
        primary_repo_id: primaryRepoRow?.id ?? null,
        primary_pr_url: prUrl,
        sibling_repo_ids: siblings.map((s) => s.id),
        sibling_repo_urls: siblings.map((s) => s.repo_url),
        rag_files_seen: codeFiles.map((f) => f.filePath).slice(0, 50),
      },
    })
    .select('id')
    .single();
  if (coordErr || !coord) {
    log.warn('fix_coordinations insert failed (non-fatal)', {
      fixAttemptId,
      err: coordErr?.message,
    });
    return;
  }

  await db
    .from('fix_attempts')
    .update({ coordination_id: coord.id })
    .eq('id', fixAttemptId);

  // Fan out a child fix_dispatch_jobs per sibling. Each carries the
  // coordination_id so the multi-repo worker (or a future fan-out
  // sweeper) groups them; `target_repo_id` is a metadata hint stored
  // in `dispatch_metadata` JSONB so the column doesn't need to exist.
  for (const sib of siblings) {
    const { error: dispatchErr } = await db.from('fix_dispatch_jobs').insert({
      project_id: projectId,
      report_id: reportId,
      coordination_id: coord.id,
      skill: 'fix',
      status: 'queued',
      dispatch_metadata: {
        target_repo_id: sib.id,
        target_repo_url: sib.repo_url,
        coordinated_with_pr: prUrl,
        sibling_count: siblings.length,
      },
    });
    if (dispatchErr) {
      log.warn('sibling dispatch insert failed (non-fatal)', {
        siblingRepoId: sib.id,
        err: dispatchErr.message,
      });
    }
  }

  // Post a cross-link comment on the primary PR — the reviewer needs to
  // know "this is half the change". GitHub Issues API works for PRs.
  if (primaryRepoRow) {
    const body = [
      `**Mushi: cross-repo coordination**`,
      ``,
      `This bug appears to span multiple repos in this project. Sibling fixes have been queued for:`,
      ``,
      ...siblings.map(
        (s) =>
          `- \`${s.repo_url}\` (${fileMatchByRepo.get(s.id)?.size ?? 0} matched file${fileMatchByRepo.get(s.id)?.size === 1 ? '' : 's'})`,
      ),
      ``,
      `Coordination id: \`${coord.id}\` — track sibling PRs on the [Repo page](/repo).`,
      ``,
      `_Generated by mushi-mushi/fix-worker. Sibling fixes will appear as separate PRs on the linked repos within a few minutes; do not merge this PR until they're ready (or merge as a coordinated batch)._`,
    ].join('\n');
    try {
      await fetch(
        `https://api.github.com/repos/${primaryRepo.owner}/${primaryRepo.repo}/issues/${prNumber}/comments`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${ghToken}`,
            'Content-Type': 'application/json',
            Accept: 'application/vnd.github+json',
          },
          body: JSON.stringify({ body }),
          signal: AbortSignal.timeout(8_000),
        },
      );
    } catch (err) {
      log.warn('cross-repo PR comment failed (non-fatal)', {
        prUrl,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  log.info('cross-repo coordination created', {
    fixAttemptId,
    coordinationId: coord.id,
    siblingCount: siblings.length,
    primaryRepoId: primaryRepoRow?.id ?? null,
  });
}

async function failDispatch(
  db: ReturnType<typeof getServiceClient>,
  dispatchId: string,
  error: string,
): Promise<void> {
  await db
    .from('fix_dispatch_jobs')
    .update({
      status: 'failed',
      error: error.slice(0, 500),
      finished_at: new Date().toISOString(),
    })
    .eq('id', dispatchId);
}

async function completeAttempt(
  db: ReturnType<typeof getServiceClient>,
  fixAttemptId: string,
  fields: Record<string, unknown>,
): Promise<void> {
  await db
    .from('fix_attempts')
    .update({
      ...fields,
      completed_at: new Date().toISOString(),
    })
    .eq('id', fixAttemptId);
}

async function resolveRepo(
  db: ReturnType<typeof getServiceClient>,
  projectId: string,
  settings: Record<string, unknown> | null,
  targetRepoId: string | null = null,
): Promise<ResolvedRepo | null> {
  // Multi-repo (deferred-6): when the dispatch carries a target_repo_id
  // hint, prefer that exact row over the project primary. This lets
  // sibling dispatches fanned out by `markCrossRepoSpan` target the
  // intended repo even though they share project_id with the primary.
  let primaryRepo: { repo_url: string; default_branch: string | null; path_globs: string[] | null } | null = null;
  if (targetRepoId) {
    const { data: targeted } = await db
      .from('project_repos')
      .select('repo_url, default_branch, path_globs')
      .eq('id', targetRepoId)
      .eq('project_id', projectId) // belt-and-suspenders against forged hints
      .maybeSingle();
    primaryRepo = targeted ?? null;
  }

  if (!primaryRepo) {
    // Prefer the multi-repo primary entry; fall back to legacy single-URL field.
    const { data: primary } = await db
      .from('project_repos')
      .select('repo_url, default_branch, path_globs')
      .eq('project_id', projectId)
      .eq('is_primary', true)
      .maybeSingle();
    primaryRepo = primary ?? null;
  }

  const url =
    primaryRepo?.repo_url ??
    (settings?.github_repo_url as string | undefined) ??
    (settings?.codebase_repo_url as string | undefined) ??
    '';
  if (!url) return null;

  const parsed = parseGithubUrl(url);
  if (!parsed) return null;

  // path_globs from project_repos can constrain which files the worker is
  // allowed to write. Empty/null means no restriction.
  const globs = (primaryRepo?.path_globs as string[] | null) ?? null;
  const scopeDirectory =
    globs && globs.length > 0 && typeof globs[0] === 'string'
      ? globs[0].replace(/\/\*\*?$/, '').replace(/^\.?\//, '')
      : undefined;

  return {
    owner: parsed.owner,
    repo: parsed.repo,
    defaultBranch: primaryRepo?.default_branch ?? 'main',
    scopeDirectory,
  };
}

function parseGithubUrl(url: string): { owner: string; repo: string } | null {
  const cleaned = url.replace(/\.git$/, '').replace(/^git@github\.com:/, 'https://github.com/');
  const match = cleaned.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}

function isFileInScope(filePath: string, scopeDir: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  if (TEST_PATTERNS.some((p) => p.test(normalized))) return true;
  return normalized.startsWith(scopeDir.replace(/\\/g, '/'));
}

const TEST_PATTERNS = [/__tests__\//, /\.test\./, /\.spec\./, /^test\//, /^tests\//];

// Belt-and-suspenders secret detector. The LLM has been instructed not to emit
// secrets; this catches accidents.
const SECRET_PATTERNS = [
  /sk-(ant-|or-|proj-|live-)?[a-zA-Z0-9_-]{20,}/,
  /ghp_[a-zA-Z0-9]{36}/,
  /AIza[a-zA-Z0-9_-]{35}/,
  /AKIA[A-Z0-9]{16}/,
];
function containsObviousSecret(content: string): boolean {
  return SECRET_PATTERNS.some((p) => p.test(content));
}

async function resolveGithubToken(
  db: ReturnType<typeof getServiceClient>,
  ownerUserId: string | null,
  projectId: string,
): Promise<string | null> {
  // Resolution order: project-level vault ref → org-default vault ref →
  // raw value in either column → env fallback (self-host / founder dogfood).
  // Never log the token.
  void ownerUserId;

  // Step 1: project-level setting.
  const { data, error } = await db
    .from('project_settings')
    .select('github_installation_token_ref')
    .eq('project_id', projectId)
    .maybeSingle();

  const resolveRef = async (ref: string): Promise<string | null> => {
    if (ref.startsWith('vault://')) {
      const id = ref.slice('vault://'.length);
      const { data: secret, error: vaultErr } = await db.rpc('vault_get_secret', { secret_id: id });
      return !vaultErr && typeof secret === 'string' && secret.length > 0 ? secret : null;
    }
    return ref.length > 0 ? ref : null;
  };

  if (!error && data?.github_installation_token_ref) {
    const resolved = await resolveRef(String(data.github_installation_token_ref));
    if (resolved) return resolved;
  }

  // Step 2: org-level default.
  const { data: projectRow } = await db
    .from('projects')
    .select('organization_id')
    .eq('id', projectId)
    .maybeSingle();
  const orgId = (projectRow as { organization_id: string | null } | null)?.organization_id ?? null;
  if (orgId) {
    const { data: orgRow } = await db
      .from('organization_integration_settings')
      .select('github_installation_token_ref')
      .eq('organization_id', orgId)
      .maybeSingle();
    if (orgRow?.github_installation_token_ref) {
      const resolved = await resolveRef(String(orgRow.github_installation_token_ref));
      if (resolved) return resolved;
    }
  }

  // Step 3: env fallback (self-host / founder dogfood).
  return Deno.env.get('GITHUB_TOKEN') ?? null;
}

/**
 * Walk: report → graph_nodes(node_type='report_group', label=reportId) →
 * graph_edges(edge_type='reports_against') → graph_nodes(node_type='action').
 * Then enrich with parent page (incoming `triggers` then `contains`) and
 * the implements story so the LLM has the full surface context.
 *
 * Returns null on any miss — the fix path MUST run for legacy reports.
 *
 * `overrideActionNodeId` lets the dispatcher skip the graph walk when it
 * already knows the anchor (e.g. an MCP caller picked one explicitly).
 */
async function loadInventoryAnchor(
  db: ReturnType<typeof getServiceClient>,
  projectId: string,
  reportId: string,
  overrideActionNodeId: string | null,
): Promise<InventoryAnchor | null> {
  try {
    let actionNodeId = overrideActionNodeId;
    if (!actionNodeId) {
      const { data: reportNode } = await db
        .from('graph_nodes')
        .select('id')
        .eq('project_id', projectId)
        .eq('node_type', 'report_group')
        .eq('label', reportId)
        .maybeSingle();
      if (!reportNode) return null;
      const { data: edge } = await db
        .from('graph_edges')
        .select('to_node_id')
        .eq('project_id', projectId)
        .eq('from_node_id', reportNode.id)
        .eq('edge_type', 'reports_against')
        .limit(1)
        .maybeSingle();
      if (!edge?.to_node_id) return null;
      actionNodeId = edge.to_node_id as string;
    }
    const { data: action } = await db
      .from('graph_nodes')
      .select('id, label, metadata')
      .eq('id', actionNodeId)
      .eq('node_type', 'action')
      .maybeSingle();
    if (!action) return null;
    const meta = (action.metadata as Record<string, unknown> | null) ?? {};

    let pagePath: string | undefined;
    let pageId: string | undefined;
    const { data: triggerEdge } = await db
      .from('graph_edges')
      .select('from_node_id')
      .eq('project_id', projectId)
      .eq('to_node_id', action.id)
      .eq('edge_type', 'triggers')
      .limit(1)
      .maybeSingle();
    if (triggerEdge?.from_node_id) {
      const { data: containsEdge } = await db
        .from('graph_edges')
        .select('from_node_id')
        .eq('project_id', projectId)
        .eq('to_node_id', triggerEdge.from_node_id)
        .eq('edge_type', 'contains')
        .limit(1)
        .maybeSingle();
      if (containsEdge?.from_node_id) {
        const { data: pageNode } = await db
          .from('graph_nodes')
          .select('metadata')
          .eq('id', containsEdge.from_node_id)
          .eq('node_type', 'page_v2')
          .maybeSingle();
        const pm = (pageNode?.metadata as Record<string, unknown> | null) ?? {};
        pagePath = typeof pm.path === 'string' ? pm.path : undefined;
        pageId = typeof pm.page_id === 'string' ? pm.page_id : undefined;
      }
    }

    let storyId: string | undefined;
    let storyTitle: string | undefined;
    const { data: implementsEdge } = await db
      .from('graph_edges')
      .select('to_node_id')
      .eq('project_id', projectId)
      .eq('from_node_id', action.id)
      .eq('edge_type', 'implements')
      .limit(1)
      .maybeSingle();
    if (implementsEdge?.to_node_id) {
      const { data: storyNode } = await db
        .from('graph_nodes')
        .select('label, metadata')
        .eq('id', implementsEdge.to_node_id)
        .eq('node_type', 'user_story')
        .maybeSingle();
      if (storyNode) {
        storyId = (storyNode.label as string | null) ?? undefined;
        const sm = (storyNode.metadata as Record<string, unknown> | null) ?? {};
        storyTitle = typeof sm.title === 'string' ? sm.title : undefined;
      }
    }

    return {
      actionNodeId: action.id as string,
      actionLabel: action.label as string,
      actionDescription: typeof meta.action === 'string' ? meta.action : undefined,
      pagePath,
      pageId,
      storyId,
      storyTitle,
      expectedOutcome: (meta.expected_outcome as Record<string, unknown> | null) ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Render the inventory anchor for the fix-worker LLM prompt.
 * Delegates to `renderSpecContextEdge` in `_shared/spec-validation.ts` so
 * both the Node-side orchestrator and this Deno worker share one canonical
 * renderer. Keeping the duplicate inline copy was the source of drift — this
 * thin wrapper preserves the existing call-site in `buildUserPrompt` with
 * zero behaviour change.
 */
function formatInventoryAnchor(anchor: InventoryAnchor): string {
  return renderSpecContextEdge(anchor as unknown as Parameters<typeof renderSpecContextEdge>[0]);
}

function buildUserPrompt(
  report: Record<string, unknown>,
  settings: Record<string, unknown> | null,
  codeContext: string,
  repo: ResolvedRepo,
  webSnippets: FirecrawlSearchResult[] = [],
  inventoryAnchor: InventoryAnchor | null = null,
  pastFixesContext = '',
): string {
  const env = (report.environment ?? {}) as Record<string, unknown>;
  const consoleErrors = ((report.console_logs ?? []) as Array<{ level: string; message: string }>)
    .filter((l) => l.level === 'error' || l.level === 'warn')
    .slice(0, 10)
    .map((l) => `[${l.level}] ${l.message}`)
    .join('\n');

  const failedRequests = (
    (report.network_logs ?? []) as Array<{ method: string; url: string; status: number }>
  )
    .filter((l) => l.status >= 400)
    .slice(0, 10)
    .map((l) => `${l.method} ${l.url} → ${l.status}`)
    .join('\n');

  const reproSteps = (report.reproduction_steps ?? []) as string[];

  const inventoryBlock = inventoryAnchor ? `\n${formatInventoryAnchor(inventoryAnchor)}\n` : '';

  return `## Bug Report
**Summary**: ${report.summary ?? '(none — see description)'}
**User description**: ${report.description ?? '(none)'}
**Category**: ${report.category ?? 'unknown'} | **Severity**: ${report.severity ?? 'unknown'}
**Component**: ${report.component ?? 'unknown'}
**Confidence**: ${report.confidence ?? 'n/a'}

## Reproduction Steps
${reproSteps.length > 0 ? reproSteps.map((s, i) => `${i + 1}. ${s}`).join('\n') : '(none captured)'}
${inventoryBlock}
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

${
  pastFixesContext
    ? `## Past Similar Fixes (fix_corpus retrieval)
These are diffs that previously fixed bugs in this same project that look semantically similar to the current report. Use them as STRONG hints for which files to touch and which patterns to apply — they're real, validated, merged fixes. Don't blindly copy line-for-line; the new bug may differ in subtle ways. But if the past fix touched a file that is also in the RAG-retrieved code above, that's almost certainly the right place to start.

${pastFixesContext}
`
    : ''
}${
  webSnippets.length > 0
    ? `## Web Context (Firecrawl auto-augment)
The local RAG was sparse OR this report has been judged "stubborn" in the past, so we pulled the top ${webSnippets.length} web result${webSnippets.length === 1 ? '' : 's'} matching the symptom. Treat these as hints — verify against the actual code before relying on them, and never copy/paste verbatim if it would conflict with the project's existing style.

${webSnippets.map((s, i) => `### [${i + 1}] ${s.title}\n<${s.url}>\n${s.snippet}`).join('\n\n')}
`
    : ''
}
## Your Task
Output a structured fix plan. Touch the minimum number of files. Match the existing code style. If you change behavior, add or update a test. If you are not confident, set needsHumanReview=true.`;
}

// ----------------------------------------------------------------------------
// GitHub PR creation via raw REST. Octokit doesn't run in Deno, but the
// Contents and Pulls APIs are simple JSON-over-HTTPS calls.
// ----------------------------------------------------------------------------


function buildPrBody(fix: FixOutput, reportId: string): string {
  const fileList = fix.files.map((f) => `- \`${f.path}\` — ${f.reason}`).join('\n');
  const reviewBanner = fix.needsHumanReview
    ? '> ⚠️ **The agent flagged this fix as needing extra human review.** Read the rationale carefully before approving.\n\n'
    : '';
  return `${reviewBanner}## Mushi Mushi Auto-Fix

**Report**: \`${reportId}\`

### Why this change
${fix.rationale}

### Files changed
${fileList}

---
*This PR was generated by Mushi Mushi using your project's BYOK LLM key. The agent operates within a circuit-breaker (max lines per file) and a structured-output schema — it cannot run shell commands or call arbitrary tools. Review every line before merging.*

[Open report in admin console](mushi://reports/${reportId})`;
}

