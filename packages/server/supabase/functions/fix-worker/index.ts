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
 *     paths + find/replace edits (or a new file's contents) + rationale,
 *     never tool calls or shell commands.
 *
 * Context (2026-10-03): the model sees whole files read from the target
 * repo at the commit the PR branches from (_shared/fix-context.ts), found
 * via report literals, stack frames and RAG; its edits are applied to those
 * same bytes (_shared/fix-edits.ts).
 *
 * Cost guard:
 *   - circuit_breaker: aborts if any single file's diff (changed lines)
 *     would exceed project_settings.autofix_max_lines (default 200).
 *   - token cap: passes maxTokens to limit blast radius even if the model
 *     misbehaves.
 *   - At most two fix generations per dispatch: one, plus one retry with
 *     the exact error when its edits do not apply. No agentic loop.
 */

import { generateObject, NoObjectGeneratedError } from 'npm:ai@4';
import { openAiProvider } from '../_shared/openai-compat.ts';
import { z } from 'npm:zod@3';
import { getServiceClient } from '../_shared/db.ts';
import { reportError, withSentry, tagLangfuseTrace } from '../_shared/sentry.ts';
import { safeErrorResponse } from '../_shared/safe-error.ts';
import { resolveLlmKey } from '../_shared/byok.ts';
import { withAnthropicOrOpenAi, LlmBudgetExceededError, LlmFailoverError } from '../_shared/llm-failover.ts';
import {
  getRelevantCodeWithReason,
  formatCodeContext,
  type CodeContext,
  type RagSkipReason,
} from '../_shared/rag.ts';
import {
  createPrFromFiles,
  fetchBaseFileState,
  generateFixBranchName,
  resolveBaseBranch,
  searchRepoCode,
} from '../_shared/github-pr.ts';
import {
  assessFixFiles,
  diffLineCount,
  fixDiffLineCount,
  fixReviewPassed,
  reportRequestsRewrite,
  type BaseFileState,
  type ProposedFile,
} from '../_shared/fix-file-guard.ts';
import {
  attributeIndexPath,
  buildFullFileContext,
  extractReportLiterals,
  isLocaleFile,
  literalSearchTerms,
  localeKeysForText,
  rankContextCandidates,
  underRepoGlobs,
  FULL_CONTEXT_LIMITS,
  type FullFileContext,
  type LinkedRepoScope,
} from '../_shared/fix-context.ts';
import {
  editRetryPrompt,
  introducedText,
  isCommentOnlyFix,
  materializeFixFiles,
} from '../_shared/fix-edits.ts';
import { matchFramePathsToTree } from '../_shared/sentry-frames.ts';
import { featureRequestDispatchBlock } from '../_shared/report-category.ts';

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
import { FIX_EFFORT, FIX_MODEL, FIX_FALLBACK } from '../_shared/models.ts';
import { claudeGenerateObject } from '../_shared/claude-messages.ts';
import { getPromptForStage } from '../_shared/prompt-ab.ts'
import { budgetSnapshot, checkAutofixBudget, dispatchTrigger, isSiblingDispatch } from '../_shared/autofix-budget.ts';
import { logLlmInvocation } from '../_shared/telemetry.ts';
import { siblingDispatchRow } from '../_shared/sibling-dispatch.ts';
import { dispatchPluginEventDetached } from '../_shared/plugins.ts';
import { notifyTeamFixEvent } from '../_shared/team-notify.ts';
import { notifyReportStatusTransition } from '../_shared/report-status-notify.ts';
import {
  applyCloudAgentOutcome,
  buildCloudAgentPrompt,
  cloudAgentBranchName,
  getCloudAgentAdapter,
  isDispatchableCloudAgent,
  recordCloudAgentDispatched,
} from '../_shared/agent-adapters.ts';

// ----------------------------------------------------------------------------
// Structured fix output lives in `_shared/fix-schema.ts` so the regression
// tests can import the schema without dragging in the Edge runtime's `npm:`
// specifiers. See that file for the MUSHI-MUSHI-SERVER-J/8 placeholder-rejection
// rationale.
// ----------------------------------------------------------------------------

import { FIX_OUTPUT_CONTRACT, fixSchema, isEditEntry, type FixOutput } from '../_shared/fix-schema.ts';
import { sentryFixesTrailers, sentryShortIdsForReport } from '../_shared/sentry-resolve-back.ts';
import { validateEdgeSpec, renderSpecContextEdge } from '../_shared/spec-validation.ts';
import { loadFixRecipeBlock } from '../_shared/fix-recipe-block.ts';

const SYSTEM_PROMPT = `You are a senior staff engineer fixing one specific bug report.

Your output is a structured fix plan that will be turned into a draft pull request. A human will review every line before it merges — you are not the last line of defense, but you are the first.

Rules:
1. Make the smallest change that resolves the bug. Do not refactor unrelated code.
2. Preserve the existing file's style, imports, and formatting.
3. If you change behavior, add or update a test in the same PR.
4. Only emit files you have actually modified. Change an existing file with find/replace edits, never by regenerating it.
5. If you are not confident the fix is correct, set needsHumanReview=true and explain in the rationale.
6. Never invent file paths. Use ONLY paths that appear in the "Relevant code" context. If the right file isn't there, set needsHumanReview=true and propose what to look at instead.
7. Never include secrets, credentials, or hardcoded API keys in your output.
8. Stay within the configured scope directory unless adding tests.

NEVER emit placeholder output. The strings "placeholder", "TODO", "lorem ipsum", "FIXME", "...", or any stub stand-in for real content are FORBIDDEN as the value of \`summary\`, \`rationale\`, \`files[].edits[].find\`/\`replace\`, \`files[].contents\`, or \`files[].reason\`. The schema will reject them and you will be retried. If you do not have enough context to write a real fix:
  - set \`needsHumanReview: true\`
  - in \`rationale\`, explain exactly which file or snippet you would need to see
  - in \`files\`, you MUST include at least one file — emit the SMALLEST plausible defensive code change you can justify (e.g. an explicit error message at the crash site or a null-guard). A file that only adds notes, markdown or TODO comments is not a fix; with needsHumanReview set, the review gate stops this attempt before any PR is opened.
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
  /** All of the repo's project_repos.path_globs; null = the whole repo. */
  pathGlobs: string[] | null;
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
    tagLangfuseTrace(trace.id);

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
    // Per-dispatch override wins over the project default. The dispatch
    // route persisted `dispatch_metadata.agent_override` since 20260521 but
    // no consumer ever read it (2026-08-16 audit P1-1) — every MCP/console
    // agent selection was silently ignored. 'auto' and legacy 'rest_worker'
    // normalize onto the runnable set below.
    const rawOverride = ((dispatch.dispatch_metadata as Record<string, unknown> | null) ?? {})
      .agent_override;
    const normalizeAgent = (a: string | null): string | null => {
      if (!a || a === 'auto') return null;
      if (a === 'rest_worker') return 'rest_fix_worker';
      return a;
    };
    const requestedAgent =
      normalizeAgent(typeof rawOverride === 'string' ? rawOverride : null) ??
      normalizeAgent((requestedSettings?.autofix_agent as string | null) ?? null) ??
      'claude_code';

    // Agents the fix-worker can actually execute today. 'claude_code' is the
    // migration default and maps to the LLM path (Anthropic primary, OpenAI
    // fallback) — the MCP-hosted Claude Code shell lives in @mushi-mushi/agents
    // and isn't reachable from Deno edge yet. 'rest_fix_worker' is the
    // explicit opt-in for this same path. 'cursor_cloud' and
    // 'github_cloud_agent' hand the report to a vendor-hosted repo agent via
    // _shared/agent-adapters.ts (step 2b below) and finish asynchronously.
    // Anything else is the Node-only orchestrator territory and must be
    // rejected rather than silently falling through.
    const SUPPORTED_AGENTS = new Set([
      'claude_code',
      'rest_fix_worker',
      'llm',
      'cursor_cloud',
      'github_cloud_agent',
    ]);

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
      await failDispatch(db, dispatch.id, `fix_attempts insert failed: ${attemptErr?.message}`, dispatch.report_id);
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
            'id, description, summary, category, category_confirmed_at, severity, component, confidence, user_intent, user_category, status, reporter_token_hash, ' +
              'stage1_classification, stage2_analysis, reproduction_steps, environment, console_logs, network_logs, ' +
              'judge_score, custom_metadata',
          )
          .eq('id', dispatch.report_id)
          // Defence in depth: the dispatch route checks this too.
          .eq('project_id', dispatch.project_id)
          .single(),
        db
          .from('project_settings')
          .select(
            'project_id, autofix_agent, autofix_max_lines, sandbox_provider, ' +
              'github_repo_url, github_default_branch, codebase_repo_url, fix_branch_template, ' +
              'autofix_max_spend_usd, autofix_max_dispatches_per_day, autofix_approval_cost_threshold_usd, ' +
              'cursor_default_model',
          )
          .eq('project_id', dispatch.project_id)
          .single(),
        db.from('projects').select('id, name, owner_id').eq('id', dispatch.project_id).single(),
      ]);
      const report = _reportRaw as unknown as Record<string, unknown> | null;
      const settings = _settingsRaw as unknown as Record<string, unknown> | null;

      if (!report) throw new Error(`Report ${dispatch.report_id} not found`);
      if (!project) throw new Error(`Project ${dispatch.project_id} not found`);

      // Defence in depth for every dispatch path: a reporter's feature
      // request never reaches the LLM or GitHub until a human re-categorizes
      // it (report 469f6962 was a feature request and became PR 424).
      const featureBlock = featureRequestDispatchBlock(report);
      if (featureBlock) {
        return await blockFixAttempt(db, trace, dispatch, fixAttemptId, featureBlock, { files_changed: [] });
      }

      // The caps bound what Mushi spends on its own. A manual dispatch (console,
      // CLI, MCP, Slack, voice, Linear delegation) proceeds past them, and the
      // 30-day spend is stamped on the dispatch row so the timeline shows it.
      // A failed budget read throws into the catch below (attempt + job fail
      // with the reason) instead of being read as "$0 spent".
      const budget = await checkAutofixBudget(db, dispatch.project_id, {
        autofix_max_spend_usd: (settings?.autofix_max_spend_usd as number | null) ?? null,
        autofix_max_dispatches_per_day: (settings?.autofix_max_dispatches_per_day as number | null) ?? null,
        autofix_approval_cost_threshold_usd:
          (settings?.autofix_approval_cost_threshold_usd as number | null) ?? null,
      }, {
        severity: report.severity as string | null,
        estimatedCostUsd: 0.25,
        trigger: dispatchTrigger(dispatch.dispatch_metadata),
        excludeDispatchId: dispatch.id,
      });
      {
        const { error: snapErr } = await db
          .from('fix_dispatch_jobs')
          .update({
            dispatch_metadata: {
              ...((dispatch.dispatch_metadata as Record<string, unknown> | null) ?? {}),
              autofix_budget: budgetSnapshot(budget),
            },
          })
          .eq('id', dispatch.id);
        if (snapErr) log.warn('autofix budget snapshot not stored', { dispatchId: dispatch.id, err: snapErr.message });
      }

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
        await stampReportAutofixBlocked(db, dispatch.report_id, budget.reason ?? 'Auto-fix budget exceeded');
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
        // Close the fix_attempt too — leaving it 'running' orphaned it
        // forever and the dispatch route's ALREADY_DISPATCHED guard then
        // blocked every redispatch (2026-08-16 audit P0-2).
        await completeAttempt(db, fixAttemptId, {
          status: 'skipped_awaiting_approval',
          error: approvalReason,
          files_changed: [],
        });
        await db.from('fix_dispatch_jobs').update({
          status: 'skipped',
          error: approvalReason,
          finished_at: new Date().toISOString(),
        }).eq('id', dispatch.id);
        await stampReportAutofixBlocked(db, dispatch.report_id, approvalReason);
        await trace.end();
        return new Response(JSON.stringify({ ok: true, skipped: true, awaiting_approval: true, reason: approvalReason }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // ---- 2b. Cloud agent hand-off (cursor_cloud / github_cloud_agent) ------
      // Repo-level agents run in the vendor's sandbox against the full
      // checkout, so the local sandbox policy, the RAG context floor and the
      // structured-output LLM call below do not apply. We build the SAME user
      // prompt the LLM path gets (report, inventory anchor, whatever RAG
      // context exists), hand it to the adapter, stamp the vendor ids on the
      // attempt and return. The dispatch row stays 'running' — the sweeper
      // only re-queues 'queued' rows — until cursor-webhook,
      // agent-status-poll or webhooks-github-indexer closes it through
      // applyCloudAgentOutcome. Failures throw into the catch below, which
      // already fails the attempt + job and notifies the team.
      if (isDispatchableCloudAgent(requestedAgent)) {
        const cloudResponse = await dispatchToCloudAgent(db, log, {
          dispatch,
          settings,
          report,
          requestedAgent,
          fixAttemptId,
          inventoryAnchor,
          trace,
        });
        await trace.end();
        return cloudResponse;
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
          await failDispatch(db, dispatch.id, `skip persist failed: ${skipUpdateErr.message}`, dispatch.report_id);
          await trace.end();
          return new Response(
            JSON.stringify({ ok: false, error: 'Failed to persist skipped state' }),
            { status: 500, headers: { 'Content-Type': 'application/json' } },
          );
        }
        await stampReportAutofixBlocked(db, dispatch.report_id, reason);
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
        await stampReportAutofixBlocked(db, dispatch.report_id, reason);
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

      // ---- 3a. Full-file context ---------------------------------------------
      // The GitHub token and the base commit are resolved BEFORE the model
      // runs: the model sees whole files read at that commit, the edits are
      // applied to those same bytes, and the PR branches from that commit.
      const ghToken = await resolveGithubToken(db, project.owner_id ?? null, dispatch.project_id);
      let base: { branch: string; sha: string } | null = null;
      if (ghToken) {
        try {
          base = await resolveBaseBranch(ghToken, repo.owner, repo.repo, repo.defaultBranch, {
            info: (msg, ctx) => log.info(msg, ctx as Record<string, unknown>),
            warn: (msg, ctx) => log.warn(msg, ctx as Record<string, unknown>),
          });
        } catch (err) {
          throw new Error(
            `GitHub base branch for ${repo.owner}/${repo.repo} could not be resolved: ${err instanceof Error ? err.message : String(err)}`.slice(0, 400),
          );
        }
      }
      const fullSpan = trace.span('context.full-files');
      const fullContext = await assembleFullFileContext(db, log, {
        projectId: dispatch.project_id,
        report,
        repo,
        ghToken,
        baseSha: base?.sha ?? null,
        ragFiles: codeFiles,
      });
      const codeContext = fullContext.text;
      fullSpan.end({
        literals: fullContext.literals,
        shown: fullContext.outcomes.map((o) => `${o.shown}:${o.path}${o.reason ? ` (${o.reason})` : ''}`).slice(0, 20),
      });

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
            functionName: 'fix-worker',
            reportId: dispatch.report_id,
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

      ctxSpan.end({
        codeFileCount: codeFiles.length,
        contextFilesShown: fullContext.shownCount,
        repo: `${repo.owner}/${repo.repo}`,
      });

      // ---- 3b. Firecrawl auto-augment when local RAG is sparse OR
      //          the report has a poor prior judge score (a "stubborn" report).
      //          The whole block is best-effort: if Firecrawl is missing the key,
      //          rate-limited, or otherwise unhappy, the worker proceeds with
      //          local-only context. We persist the trace id + URLs onto
      //          fix_attempts so the Fixes page shows what the agent saw.
      const judgeScore = typeof report.judge_score === 'number' ? report.judge_score : null;
      const augmentReason: 'rag_sparse' | 'low_judge_score' | null =
        fullContext.shownCount < 3
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
      // Gate on the files the model would actually see: a Sentry report whose
      // literal search found the emitting file is grounded even when RAG
      // returned nothing (indexing off, embedding key revoked).
      if (fullContext.shownCount < MIN_RAG_CHUNKS && webSnippets.length === 0) {
        const reason =
          codeFiles.length > 0
            ? `None of the ${codeFiles.length} indexed file(s) matching this report could be read from ${repo.owner}/${repo.repo}` +
              `${base ? `@${base.branch}` : ''} (${fullContext.outcomes.map((o) => `${o.path}: ${o.reason ?? o.shown}`).join('; ').slice(0, 240)}). Re-index the repo, then retry.`
            : ragSkipReasonMessage(ragResult.reason, ragResult.detail);
        log.warn('Fix skipped: no grounding context available', {
          reportId: dispatch.report_id,
          codeFiles: codeFiles.length,
          contextFilesShown: fullContext.shownCount,
          webSnippets: webSnippets.length,
          minRagChunks: MIN_RAG_CHUNKS,
          ragReason: ragResult.reason,
          ragDetail: ragResult.detail ?? null,
        });
        // `embedding_failed` / `rpc_failed` are pipeline faults — a revoked
        // BYOK key, a missing migration — not "the codebase had nothing
        // relevant". Filing them as no_relevant_code (an EXPECTED category,
        // see EXPECTED_FAILURE_CATEGORIES) also kept them out of Sentry:
        // glot.it's embedding key 401'd for two months and every dispatch was
        // silently skipped with "couldn't find relevant code". The console
        // already renders context_assembly_failed as a retrieval-pipeline
        // error (deriveRecommendation.ts, dispatch-prerequisites.mdx).
        const failureCategory =
          ragResult.reason === 'embedding_failed' || ragResult.reason === 'rpc_failed'
            ? 'context_assembly_failed'
            : 'no_relevant_code';
        await completeAttempt(db, fixAttemptId, {
          status: 'skipped_no_context',
          error: reason,
          files_changed: [],
          failure_category: failureCategory,
        });
        await db
          .from('fix_dispatch_jobs')
          .update({
            status: 'skipped',
            error: reason,
            finished_at: new Date().toISOString(),
          })
          .eq('id', dispatch.id);
        await stampReportAutofixBlocked(db, dispatch.report_id, reason);
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
        // Tokens plus the fixer context: tables the stack trace names, the
        // last fix's deploy state and open radar findings (≤ 4 KB in all).
        await loadFixRecipeBlock(db, dispatch.project_id, report),
        base ? { branch: base.branch, sha: base.sha } : null,
      );

      // Resolve the fix-worker system prompt from `prompt_versions` (stage='fix').
      // Falls back to the hardcoded SYSTEM_PROMPT when no global or project row
      // exists (first boot before migration 20260422110000 runs, or when the
      // operator has deleted every fix-stage row). Wired here so operators can
      // A/B rewrite the senior-engineer rubric without redeploying. The output
      // contract (find/replace edits) belongs to the worker, not the A/B
      // prompt, so it is appended to whichever prompt is active.
      const fixPromptSelection = await getPromptForStage(db, dispatch.project_id, 'fix');
      const activeFixSystemPrompt = `${fixPromptSelection.promptTemplate ?? SYSTEM_PROMPT}\n\n${FIX_OUTPUT_CONTRACT}`;
      const fixPromptVersion = fixPromptSelection.promptVersion;

      // ---- 5. Call LLM with structured output (multi-key failover) ----------
      const llmSpan = trace.span('llm.fix');
      const llmStart = Date.now();
      let usedModel = '';
      let inputTokens = 0;
      let outputTokens = 0;
      let usedKeySource: 'byok' | 'env' | null = null;

      const DEFAULT_ANTHROPIC_MODEL = FIX_MODEL;
      const DEFAULT_OPENAI_MODEL = `openai/${FIX_FALLBACK}`;
      const MAX_OUTPUT_RETRIES = 2;

      /**
       * One structured fix generation, with the schema-violation retries.
       * `followUp` continues the conversation (the previous output as the
       * assistant turn, the feedback as a new user turn): the one retry after
       * edits failed to apply. Returns a Response when the attempt was blocked.
       * Tokens accumulate across calls and every successful call is logged, so
       * the auto-fix spend cap sees the retry too.
       */
      const generateFix = async (
        followUp: { previous: FixOutput; feedback: string } | null,
      ): Promise<FixOutput | Response> => {
        const turns: Array<{ role: 'user' | 'assistant'; content: string }> = [
          { role: 'user', content: userPrompt },
          ...(followUp
            ? [
                { role: 'assistant' as const, content: JSON.stringify(followUp.previous) },
                { role: 'user' as const, content: followUp.feedback },
              ]
            : []),
        ];
        let lastLlmErr: unknown = null;
        for (let attempt = 0; attempt <= MAX_OUTPUT_RETRIES; attempt++) {
          const callStart = Date.now();
          let callInputTokens = 0;
          let callOutputTokens = 0;
          try {
            const { result, usedProvider } = await withAnthropicOrOpenAi(
              db,
              dispatch.project_id,
              async (anthropicResolved) => {
                usedModel = DEFAULT_ANTHROPIC_MODEL;
                usedKeySource = anthropicResolved.source;
                const { object, usage } = await claudeGenerateObject({
                  apiKey: anthropicResolved.key,
                  model: usedModel,
                  schema: fixSchema,
                  effort: FIX_EFFORT,
                  // Whole files in, edits out; at medium effort a long
                  // generation needs more than the default per-call timeout.
                  timeoutMs: 300_000,
                  messages: [
                    {
                      role: 'system',
                      content: activeFixSystemPrompt,
                      experimental_providerMetadata: {
                        anthropic: { cacheControl: { type: 'ephemeral' } },
                      },
                    },
                    ...turns,
                  ],
                  // 8K of fix output plus room for adaptive thinking, which
                  // counts toward max_tokens on Sonnet 5.5.
                  maxTokens: 16_000,
                });
                callInputTokens = usage?.promptTokens ?? 0;
                callOutputTokens = usage?.completionTokens ?? 0;
                return object;
              },
              async (openaiResolved) => {
                const openaiKey = openaiResolved.key;
                const openaiBaseUrl = openaiResolved.baseUrl;
                const isOpenRouter = openaiBaseUrl?.includes('openrouter.ai') ?? false;
                usedModel = isOpenRouter ? DEFAULT_OPENAI_MODEL : FIX_FALLBACK;
                usedKeySource = openaiResolved.source;
                const openai = openAiProvider({
                  apiKey: openaiKey,
                  ...(openaiBaseUrl ? { baseURL: openaiBaseUrl } : {}),
                });
                const { object, usage } = await generateObject({
                  model: openai(usedModel),
                  schema: fixSchema,
                  temperature: 0,
                  system: activeFixSystemPrompt,
                  messages: turns,
                  maxTokens: 8_000,
                });
                callInputTokens = usage?.promptTokens ?? 0;
                callOutputTokens = usage?.completionTokens ?? 0;
                return object;
              },
            );
            inputTokens += callInputTokens;
            outputTokens += callOutputTokens;
            // The auto-fix spend cap sums llm_invocations rows for fix-worker.
            void logLlmInvocation(db, {
              projectId: dispatch.project_id,
              reportId: dispatch.report_id,
              functionName: 'fix-worker',
              stage: 'fix',
              primaryModel: DEFAULT_ANTHROPIC_MODEL,
              usedModel,
              fallbackUsed: usedProvider !== 'anthropic',
              fallbackReason: usedProvider !== 'anthropic' ? 'anthropic_unavailable' : null,
              status: 'success',
              latencyMs: Date.now() - callStart,
              inputTokens: callInputTokens,
              outputTokens: callOutputTokens,
              promptVersion: fixPromptVersion ?? null,
              keySource: usedKeySource,
              langfuseTraceId: trace.id,
            });
            return result;
          } catch (llmErr) {
            lastLlmErr = llmErr;
            if (NoObjectGeneratedError.isInstance(llmErr) && attempt < MAX_OUTPUT_RETRIES) {
              log.warn('Fix worker output validation failed — retrying', { attempt: attempt + 1 });
              continue;
            }
            // Over the monthly LLM budget: a state the owner set, not a crash.
            // Block the attempt with the reason (report shows autofix_blocked)
            // instead of the failure path that notifies the team.
            if (llmErr instanceof LlmBudgetExceededError) {
              llmSpan.end({ error: 'llm_budget_exceeded' });
              return await blockFixAttempt(db, trace, dispatch, fixAttemptId, llmErr.message, { files_changed: [] });
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
        throw new Error(
          `LLM call failed after ${MAX_OUTPUT_RETRIES + 1} attempts: ${String(lastLlmErr).slice(0, 200)}`,
        );
      };

      const firstFix = await generateFix(null);
      if (firstFix instanceof Response) return firstFix;
      let fix: FixOutput = firstFix;

      // ---- 6. Validate scope + secrets, then the review gate -----------------
      // Scope and the token scan read what the model proposed; the secret scan
      // covers only text the model wrote (replace strings, new files), so a
      // token-shaped string already in a file never blocks an unrelated fix.
      validateFixProposal(fix, repo.pathGlobs);

      // The model flags its own low-confidence output with needsHumanReview.
      // PR #424 was a blind whole-file rewrite opened anyway. Fixes are now
      // find/replace edits anchored to the real file, so a flagged fix whose
      // edits apply cleanly opens as a DRAFT PR (never marked ready, labelled
      // needs-review, banner in the body) for a person to judge. A flagged fix
      // that cannot be applied to the real files is still stopped here.
      const reviewBlock = (f: FixOutput, reason: string) =>
        blockFixAttempt(db, trace, dispatch, fixAttemptId, reason.slice(0, 450), {
          files_changed: f.files.map((x) => x.path),
          lines_changed: proposalLineCount(f),
          summary: f.summary,
          rationale: f.rationale,
          llm_model: usedModel,
          llm_input_tokens: inputTokens,
          llm_output_tokens: outputTokens,
          review_passed: false,
        });
      const reviewFailedReason = (f: FixOutput) =>
        `review_failed: the fix model flagged its own change for human review. ${f.rationale}`;
      if (!fixReviewPassed(fix) && !(ghToken && base)) {
        llmSpan.end({ model: usedModel, inputTokens, outputTokens, latencyMs: Date.now() - llmStart });
        return await reviewBlock(fix, reviewFailedReason(fix));
      }

      // ---- 6a. Apply the edits to the files read at the base commit --------
      // Every path the fix touches is read at `base.sha` (context files were
      // already read there). Edits that do not match exactly once go back to
      // the model once with the precise error; a second failure stops the
      // attempt. A guess is never written.
      const baseStates = new Map<string, BaseFileState>(fullContext.states);
      let materialized: ProposedFile[] | null = null;
      if (ghToken && base) {
        const readMissing = async (f: FixOutput) => {
          for (const entry of f.files) {
            if (!baseStates.has(entry.path)) {
              baseStates.set(entry.path, await fetchBaseFileState(ghToken, repo.owner, repo.repo, base.sha, entry.path));
            }
          }
        };
        await readMissing(fix);
        let applied = materializeFixFiles(fix.files, baseStates);
        if (applied.errors.length > 0) {
          log.warn('Fix edits did not apply — retrying once with the errors', {
            dispatchId: dispatch.id,
            errors: applied.errors.slice(0, 5),
          });
          const retried = await generateFix({ previous: fix, feedback: editRetryPrompt(applied.errors) });
          if (retried instanceof Response) return retried;
          fix = retried;
          validateFixProposal(fix, repo.pathGlobs);
          await readMissing(fix);
          applied = materializeFixFiles(fix.files, baseStates);
          if (applied.errors.length > 0) {
            llmSpan.end({ model: usedModel, inputTokens, outputTokens, latencyMs: Date.now() - llmStart });
            return await reviewBlock(
              fix,
              `review_failed: the fix's edits could not be applied to ${repo.owner}/${repo.repo}@${base.sha.slice(0, 7)} after one retry: ${applied.errors.join('; ')}`,
            );
          }
        }
        materialized = applied.files;
      }
      llmSpan.end({ model: usedModel, inputTokens, outputTokens, latencyMs: Date.now() - llmStart });

      // A comment is not a fix: stop any proposal whose every changed line is
      // a comment or blank, flagged or not, before anything reaches GitHub.
      if (isCommentOnlyFix(fix.files)) {
        return await reviewBlock(
          fix,
          `review_failed: the proposed change only adds or removes comments, which is not a fix. ${fix.rationale}`,
        );
      }

      // ---- 6b. Circuit breaker on changed lines ----------------------------
      // Counted on the diff, not the file length: a two-line fix in a
      // 600-line file is two lines. Without a base (no GitHub access) the
      // proposal's own size stands in.
      const maxLines = (settings?.autofix_max_lines as number | undefined) ?? 200;
      const perFileLines = materialized
        ? materialized.map((f) => {
            const before = baseStates.get(f.path);
            return { path: f.path, lines: diffLineCount(before?.kind === 'exists' ? before.contents : null, f.contents) };
          })
        : fix.files.map((f) => ({ path: f.path, lines: entryLineCount(f) }));
      const totalLines = perFileLines.reduce((n, f) => n + f.lines, 0);
      const overCap = perFileLines.filter((f) => f.lines > maxLines);
      if (overCap.length > 0) {
        throw new Error(
          `Validation failed: ${overCap.map((f) => `${f.path}: ${f.lines} changed lines exceeds circuit breaker (${maxLines}).`).join(' ')}`,
        );
      }

      // ---- 6c. Spec-traceability gate (pre-PR) --------------------------------
      // Run the deterministic inventory contract checks before we open a PR.
      // Hard violations (JSON path deletion, etc.) surface as errors on the
      // fix_attempt so reviewers see them inline — they do NOT abort the PR
      // unless the diff is objectively regressive (errors[] non-empty).
      // Soft warnings land in spec_validation_warnings and render as the
      // amber "Spec N" badge in FixCard.
      let specValidationWarnings: Array<{ code: string; message: string; hint?: string }> = [];
      if (inventoryAnchor) {
        const specFiles = materialized ?? fix.files.map((f) => ({ path: f.path, contents: introducedText(f) }));
        const diffText: string | undefined = undefined; // edge runtime: no diff yet at this stage
        const specResult = validateEdgeSpec(inventoryAnchor as unknown as Parameters<typeof validateEdgeSpec>[0], specFiles, diffText);
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

      // ---- 7. No GitHub access: keep the proposal, open nothing ------------
      if (!ghToken || !base || !materialized) {
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
          review_passed: fixReviewPassed(fix),
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
        await stampReportAutofixBlocked(
          db,
          dispatch.report_id,
          'Fix generated but not pushed — no GitHub App installed. Connect the repo to enable auto-PRs.',
        );
        await trace.end();
        return new Response(JSON.stringify({ ok: true, fixAttemptId, prUrl: null, blockedSetup: true }), {
          status: 200,
        });
      }

      // ---- 7b. Blind-write guard ---------------------------------------------
      // The patched files are full contents built from what the base commit
      // holds. A file we could not read never got this far; a patch that
      // deletes most of a file is still a rewrite and is dropped unless the
      // report asked for one.
      const fileAssessment = assessFixFiles(materialized, baseStates, {
        allowRewrite: reportRequestsRewrite([
          report.description as string | undefined,
          report.summary as string | undefined,
          report.user_intent as string | undefined,
        ]),
      });
      if (fileAssessment.blockReason) {
        return await blockFixAttempt(db, trace, dispatch, fixAttemptId, fileAssessment.blockReason, {
          files_changed: fix.files.map((f) => f.path),
          lines_changed: totalLines,
          summary: fix.summary,
          rationale: fix.rationale,
          llm_model: usedModel,
          llm_input_tokens: inputTokens,
          llm_output_tokens: outputTokens,
          review_passed: fixReviewPassed(fix),
        });
      }
      const prFiles = fileAssessment.kept;
      // Real diff size (+added −deleted) against the base we just read, not the
      // new file's length — matches the "+a −d" GitHub shows on the PR.
      const prLines = fixDiffLineCount(prFiles, baseStates);
      for (const d of fileAssessment.dropped) {
        specValidationWarnings.push({
          code: 'FILE_DROPPED',
          message: `${d.path} was not written: ${d.reason}.`,
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
          defaultBranch: base.branch,
          // Branch from the exact commit the edits were applied to.
          baseSha: base.sha,
          branch: prBranch,
          title: fix.summary,
          body: buildPrBody({ ...fix, files: prFiles }, dispatch.report_id),
          files: prFiles,
          labels: fixReviewPassed(fix) ? ['mushi-autofix'] : ['mushi-autofix', 'needs-review'],
          // A fix the model flagged stays a draft: CI and merge wait for a person.
          markReady: fixReviewPassed(fix),
          // `Fixes <SHORT-ID>` for Sentry-linked reports (sentry-resolve-back.ts).
          commitTrailers: sentryFixesTrailers(
            await sentryShortIdsForReport(db, dispatch.project_id, dispatch.report_id),
          ),
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
        files_changed: prFiles.map((f) => f.path),
        lines_changed: prLines,
        summary: fix.summary,
        rationale: fix.rationale,
        llm_model: usedModel,
        llm_input_tokens: inputTokens,
        llm_output_tokens: outputTokens,
        review_passed: fixReviewPassed(fix),
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
          // Clear any stale autofix_blocked stamp from a prior skipped/failed
          // attempt — this attempt made it through.
          processing_error: null,
        })
        .eq('id', dispatch.report_id)
        .eq('project_id', dispatch.project_id);

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
      dispatchPluginEventDetached(db, dispatch.project_id, 'fix.proposed', {
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

      // Team channels (Slack thread / Discord / Teams): the draft-PR link,
      // threaded onto the report's original Slack card when one exists.
      void notifyTeamFixEvent(db, dispatch.project_id, dispatch.report_id, 'fix_pr_opened', {
        prUrl: prResult.url,
        prNumber: prResult.number,
        branch: prResult.branch,
      }).catch((e) =>
        log.warn('Team fix notification failed', { event: 'fix_pr_opened', err: String(e) }),
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
      // Only a primary dispatch fans out. A sibling job (it carries the
      // parent's coordination_id) fanning out again would queue a job for
      // the original repo, which fans out again — an endless ping-pong.
      try {
        if (isSiblingDispatch(dispatch)) {
          log.info('sibling dispatch: cross-repo fan-out skipped', { dispatchId: dispatch.id });
        } else await markCrossRepoSpan(db, ghToken, log, {
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

      await failDispatch(db, dispatch.id, errMsg, dispatch.report_id);

      // Loop-closure: notify plugins so triagers see "agent tried and gave
      // up" in Slack/Jira/Sentry rather than the report sitting silently in
      // 'classified' forever. Same rationale as the success-path
      // fix.proposed dispatch above.
      dispatchPluginEventDetached(db, dispatch.project_id, 'fix.failed', {
        report: { id: dispatch.report_id },
        fix: {
          id: fixAttemptId,
          agent: 'mushi-fix-worker',
          error: errMsg.slice(0, 500),
          failureCategory,
        },
      }).catch((e) => log.warn('Plugin dispatch failed', { event: 'fix.failed', err: String(e) }));

      void notifyTeamFixEvent(db, dispatch.project_id, dispatch.report_id, 'fix_failed', {
        error: errMsg.slice(0, 500),
        failureCategory,
      }).catch((e) =>
        log.warn('Team fix notification failed', { event: 'fix_failed', err: String(e) }),
      );

      await trace.end();

      return safeErrorResponse({ status: 500 });
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
  'branch_naming',
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
  if (m.includes('does not match required pattern') && m.includes('branch name')) {
    return 'branch_naming';
  }
  // Spec/inventory checker (validateAgainstSpec).
  if (m.includes('spec violation') || m.includes('inventory contract')) return 'spec_violation';
  // Sandbox lifecycle — these can come from agents/sandbox or claude code adapters.
  if (m.includes('sandbox') && m.includes('timeout')) return 'sandbox_timeout';
  if (m.includes('sandbox')) return 'sandbox_error';
  // Cursor Cloud (agent-adapters.ts / cursor-cloud.ts). CursorApiError
  // messages start with "Cursor API <status> <code>:"; the key-missing
  // pre-flight says "Cursor API key not configured".
  if (m.includes('cursor api') || m.includes('cursor run') || m.includes('cursor agent')) {
    if (m.includes('invalid_model') || m.includes('invalid model')) return 'cursor_invalid_model';
    if (m.includes('validation_error')) return 'cursor_validation_error';
    return 'cursor_api_error';
  }
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
  // `skill` used to be 'fix', which fix_dispatch_jobs_skill_check rejects: no
  // sibling dispatch was ever created, and the failure was logged as
  // non-fatal. Sibling dispatches are started by Mushi, not a person, so they
  // carry no 'manual' trigger and stay under the auto-fix caps.
  const siblingFailures: string[] = [];
  for (const sib of siblings) {
    const { error: dispatchErr } = await db.from('fix_dispatch_jobs').insert(
      siblingDispatchRow({
        projectId,
        reportId,
        coordinationId: coord.id,
        sibling: sib,
        prUrl,
        siblingCount: siblings.length,
      }),
    );
    if (dispatchErr) {
      siblingFailures.push(`${sib.repo_url}: ${dispatchErr.message}`);
      log.error('sibling dispatch insert failed', {
        siblingRepoId: sib.id,
        err: dispatchErr.message,
      });
    }
  }
  if (siblingFailures.length > 0) {
    reportError(new Error(`cross-repo sibling dispatch failed: ${siblingFailures.join('; ')}`), {
      tags: { function: 'fix-worker', stage: 'sibling_dispatch' },
    });
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

interface CloudDispatchContext {
  dispatch: {
    id: string;
    project_id: string;
    report_id: string;
    dispatch_metadata: unknown;
  };
  settings: Record<string, unknown> | null;
  report: Record<string, unknown>;
  requestedAgent: 'cursor_cloud' | 'github_cloud_agent';
  fixAttemptId: string;
  inventoryAnchor: InventoryAnchor | null;
  trace: ReturnType<typeof createTrace>;
}

/**
 * Step 2b: hand the report to a vendor-hosted repo agent (Cursor Cloud v1 or
 * GitHub Copilot Agent Tasks) through `_shared/agent-adapters.ts` and return
 * immediately. Writes, in order:
 *   1. fix_attempts.branch_name (BEFORE the vendor call, so a pull_request
 *      webhook that beats our own bookkeeping can still be matched by head
 *      ref in webhooks-github-indexer);
 *   2. the vendor ids (cursor_agent_id / cursor_run_id or github_task_id /
 *      github_task_url) + external_agent_ref on the attempt, status 'running';
 *   3. a `dispatched` fix_events breadcrumb;
 *   4. the `fix.requested` plugin event (carries externalAgentId so the Cursor
 *      marketplace plugin does not start a second agent);
 *   5. the team 'fix_dispatched' card for dispatches that did NOT come through
 *      dispatchFixForReport (those already posted one).
 * Any thrown error lands in the caller's catch, which fails the attempt +
 * job, stamps the report and notifies — same as the LLM path.
 */
async function dispatchToCloudAgent(
  db: ReturnType<typeof getServiceClient>,
  log: Logger,
  ctx: CloudDispatchContext,
): Promise<Response> {
  const { dispatch, settings, report, requestedAgent, fixAttemptId, inventoryAnchor, trace } = ctx;
  const dispatchMeta = (dispatch.dispatch_metadata as Record<string, unknown> | null) ?? {};
  const targetRepoId = typeof dispatchMeta.target_repo_id === 'string' ? dispatchMeta.target_repo_id : null;
  const repo = await resolveRepo(db, dispatch.project_id, settings, targetRepoId);
  if (!repo) {
    throw new Error(
      'No GitHub repo configured for this project. Set Settings → Integrations → GitHub repo.',
    );
  }

  // RAG is a hint for a repo-level agent, never a gate — it has the whole
  // checkout. Best-effort, and an indexing failure must not block dispatch.
  let codeContext = '';
  try {
    const ragSpan = trace.span('context.rag');
    const ragResult = await getRelevantCodeWithReason(db, dispatch.project_id, {
      symptom:
        (report.summary as string | undefined) ??
        (report.description as string | undefined)?.slice(0, 200) ??
        '',
      action: (report.user_intent as string | undefined) ?? '',
      component: (report.component as string | undefined) ?? '',
    });
    // The index is project-wide: hint only files attributable to the
    // target repo (a sibling repo's preview would point the agent astray).
    const scope = await loadLinkedRepoScope(db, dispatch.project_id, repo);
    const ownFiles = ragResult.files.filter((f) => attributeIndexPath(f.filePath, scope) === 'target');
    codeContext = formatCodeContext(ownFiles);
    ragSpan.end({ fileCount: ownFiles.length, droppedOtherRepo: ragResult.files.length - ownFiles.length, reason: ragResult.reason });
  } catch (err) {
    log.warn('RAG context unavailable for cloud agent (non-fatal)', {
      reportId: dispatch.report_id,
      err: err instanceof Error ? err.message : String(err),
    });
  }

  const branchName = cloudAgentBranchName(
    requestedAgent,
    dispatch.report_id,
    (report.category as string | null | undefined) ?? null,
  );
  const basePrompt = buildUserPrompt(report, settings, codeContext, repo, [], inventoryAnchor, '');
  const prompt = buildCloudAgentPrompt(basePrompt, {
    reportId: dispatch.report_id,
    repoOwner: repo.owner,
    repoName: repo.repo,
    baseRef: repo.defaultBranch,
    branchName,
    kind: requestedAgent,
  });
  const repoUrl = `https://github.com/${repo.owner}/${repo.repo}`;
  const model =
    requestedAgent === 'cursor_cloud' && typeof settings?.cursor_default_model === 'string'
      ? settings.cursor_default_model
      : undefined;
  const now = new Date().toISOString();

  await db
    .from('fix_attempts')
    .update({ branch_name: branchName, started_at: now })
    .eq('id', fixAttemptId);

  const adapter = getCloudAgentAdapter(requestedAgent);
  const dispatchSpan = trace.span('cloud.dispatch');
  const result = await adapter.dispatch({
    db,
    projectId: dispatch.project_id,
    reportId: dispatch.report_id,
    dispatchId: dispatch.id,
    attemptId: fixAttemptId,
    repoUrl,
    baseRef: repo.defaultBranch,
    prompt,
    branchName,
    model,
    name: `Mushi fix ${dispatch.report_id.slice(0, 8)}`,
  });
  dispatchSpan.end({
    agent: requestedAgent,
    externalAgentId: result.externalAgentId,
    externalRunId: result.externalRunId ?? null,
  });

  const attemptUpdate: Record<string, unknown> = {
    status: 'running',
    branch_name: branchName,
    external_agent_ref: {
      ...(result.ref ?? {}),
      kind: requestedAgent,
      external_agent_id: result.externalAgentId,
      external_run_id: result.externalRunId ?? null,
      status_url: result.statusUrl ?? null,
      branch_name: branchName,
      dispatched_at: now,
    },
  };
  // The model the agent was asked to run (Cursor model id plus params), so
  // the Fix card says what ran instead of leaving it blank.
  if (model) attemptUpdate.llm_model = model.slice(0, 200);
  if (requestedAgent === 'cursor_cloud') {
    attemptUpdate.cursor_agent_id = result.externalAgentId;
    if (result.externalRunId) attemptUpdate.cursor_run_id = result.externalRunId;
  } else {
    attemptUpdate.github_task_id = result.externalAgentId;
    attemptUpdate.github_task_url = result.statusUrl ?? null;
  }
  const { error: attemptUpdateErr } = await db
    .from('fix_attempts')
    .update(attemptUpdate)
    .eq('id', fixAttemptId);
  if (attemptUpdateErr) {
    // The vendor agent is already running; losing its id would orphan it.
    throw new Error(`Cloud agent dispatched (${result.externalAgentId}) but fix_attempts update failed: ${attemptUpdateErr.message}`);
  }

  // Keep the job 'running' (sweeper-safe) and expose the vendor pointer to
  // the console / A2A GET without a join.
  await db
    .from('fix_dispatch_jobs')
    .update({
      dispatch_metadata: {
        ...dispatchMeta,
        cloud_agent: {
          kind: requestedAgent,
          externalAgentId: result.externalAgentId,
          externalRunId: result.externalRunId ?? null,
          statusUrl: result.statusUrl ?? null,
          branchName,
        },
      },
    })
    .eq('id', dispatch.id);

  const target = {
    attemptId: fixAttemptId,
    projectId: dispatch.project_id,
    reportId: dispatch.report_id,
    agent: requestedAgent,
  };
  await recordCloudAgentDispatched(db, target, result);

  dispatchPluginEventDetached(db, dispatch.project_id, 'fix.requested', {
    report: {
      id: dispatch.report_id,
      status: typeof report.status === 'string' ? report.status : 'classified',
    },
    fix: {
      id: fixAttemptId,
      status: 'requested',
      agent: requestedAgent,
      externalAgentId: result.externalAgentId,
      externalRunId: result.externalRunId ?? null,
      statusUrl: result.statusUrl ?? null,
      branch: branchName,
      pullRequestUrl: result.prUrl ?? undefined,
    },
    reportId: dispatch.report_id,
    dispatchId: dispatch.id,
    attemptId: fixAttemptId,
    agent: requestedAgent,
    externalAgentId: result.externalAgentId,
    prUrl: result.prUrl ?? null,
  }).catch((e) => log.warn('Plugin dispatch failed', { event: 'fix.requested', err: String(e) }));

  if (typeof dispatchMeta.source !== 'string') {
    void notifyTeamFixEvent(db, dispatch.project_id, dispatch.report_id, 'fix_dispatched', {
      branch: branchName,
    }).catch((e) =>
      log.warn('Team fix notification failed', { event: 'fix_dispatched', err: String(e) }),
    );
  }

  // Rare: the vendor already reports a PR (an agent_id_conflict reuse of a
  // run that finished between invokes). Close the loop right away.
  if (result.prUrl) {
    await applyCloudAgentOutcome(db, target, { kind: 'pr_opened', prUrl: result.prUrl, branch: branchName });
  }

  log.info('cloud.dispatched', {
    dispatchId: dispatch.id,
    fixAttemptId,
    agent: requestedAgent,
    externalAgentId: result.externalAgentId,
    externalRunId: result.externalRunId ?? null,
    branchName,
  });

  return new Response(
    JSON.stringify({
      ok: true,
      dispatched: true,
      agent: requestedAgent,
      fixAttemptId,
      externalAgentId: result.externalAgentId,
      externalRunId: result.externalRunId ?? null,
      statusUrl: result.statusUrl ?? null,
      prUrl: result.prUrl ?? null,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

async function failDispatch(
  db: ReturnType<typeof getServiceClient>,
  dispatchId: string,
  error: string,
  reportId?: string | null,
): Promise<void> {
  await db
    .from('fix_dispatch_jobs')
    .update({
      status: 'failed',
      error: error.slice(0, 500),
      finished_at: new Date().toISOString(),
    })
    .eq('id', dispatchId);
  if (reportId) await stampReportAutofixBlocked(db, reportId, error);
}

/**
 * Make a blocked/failed auto-fix visible in triage (2026-08-16 audit P0-2).
 *
 * Every skip/fail branch used to write only fix_dispatch_jobs /
 * fix_attempts — never the report — so a dispatched-and-skipped report was
 * indistinguishable from one nobody touched, and triage_issue recommended
 * dispatch_fix in an infinite loop. reports.status stays untouched (the
 * 14-value CHECK has no "blocked" state and widening it ripples through six
 * surfaces); the structured `processing_error` column carries the reason
 * instead. Consumers: triage_issue (MCP) and the console report views.
 * The success path clears it.
 */
async function stampReportAutofixBlocked(
  db: ReturnType<typeof getServiceClient>,
  reportId: string,
  reason: string,
): Promise<void> {
  const { error } = await db
    .from('reports')
    .update({ processing_error: `autofix_blocked: ${reason}`.slice(0, 500) })
    .eq('id', reportId);
  if (error) {
    rootLog.child('fix-worker').warn('Failed to stamp autofix_blocked on report', {
      reportId,
      error: error.message,
    });
  }
}

/**
 * Stop an attempt at a pre-PR guard (review gate, blind-write guard). Same
 * shape as the context-floor gate: the attempt keeps what the model proposed
 * so a human can read it, the dispatch and report say why, nothing touches
 * GitHub, and the response is a 200 because the guard did its job.
 * `validation_rejected` is in the fix_attempts.failure_category CHECK and in
 * EXPECTED_FAILURE_CATEGORIES, so this never pages Sentry.
 */
async function blockFixAttempt(
  db: ReturnType<typeof getServiceClient>,
  trace: { end: () => Promise<unknown> },
  dispatch: { id: string; report_id: string },
  fixAttemptId: string,
  reason: string,
  fields: Record<string, unknown>,
): Promise<Response> {
  rootLog.child('fix-worker').warn('Fix blocked before PR', { dispatchId: dispatch.id, reason });
  await completeAttempt(db, fixAttemptId, {
    ...fields,
    status: 'failed',
    error: reason,
    failure_category: 'validation_rejected',
  });
  await db
    .from('fix_dispatch_jobs')
    .update({ status: 'failed', error: reason.slice(0, 500), finished_at: new Date().toISOString() })
    .eq('id', dispatch.id);
  await stampReportAutofixBlocked(db, dispatch.report_id, reason);
  await trace.end();
  return new Response(JSON.stringify({ ok: true, blocked: true, reason, fixAttemptId }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
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
    // The connected repo's branch, then the branch saved on the GitHub card,
    // then main. The card's branch used to be saved but never read.
    defaultBranch: primaryRepo?.default_branch || savedBranch(settings) || 'main',
    scopeDirectory,
    pathGlobs: globs && globs.length > 0 ? globs.filter((g) => typeof g === 'string') : null,
  };
}

/** project_settings.github_default_branch when it is a plausible ref name. */
export function savedBranch(settings: Record<string, unknown> | null): string | null {
  const b = settings?.github_default_branch
  if (typeof b !== 'string') return null
  const t = b.trim()
  return t && /^[A-Za-z0-9._/-]{1,200}$/.test(t) && !t.includes('..') ? t : null
}

function parseGithubUrl(url: string): { owner: string; repo: string } | null {
  const cleaned = url.replace(/\.git$/, '').replace(/^git@github\.com:/, 'https://github.com/');
  const match = cleaned.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}

/**
 * Every path glob of the target repo counts (it used to be only the first),
 * matched on whole path segments. Test files stay allowed anywhere.
 */
function isFileInScope(filePath: string, pathGlobs: readonly string[]): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  if (TEST_PATTERNS.some((p) => p.test(normalized))) return true;
  return underRepoGlobs(normalized, pathGlobs);
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

/**
 * Scope and secret checks on what the model proposed. Throws
 * `Validation failed: …` (categorized as scope_blocked / spec_violation).
 * The secret scan reads only text the model wrote: `replace` strings and new
 * files. Scanning whole patched files would block a fix for a token-shaped
 * string (e.g. a long kebab-case class name) that was already in the file.
 */
function validateFixProposal(fix: FixOutput, pathGlobs: readonly string[] | null): void {
  const errors: string[] = [];
  for (const f of fix.files) {
    if (pathGlobs && pathGlobs.length > 0 && !isFileInScope(f.path, pathGlobs)) {
      errors.push(`${f.path}: outside scope ${pathGlobs.join(', ')}.`);
    }
    if (containsObviousSecret(introducedText(f))) {
      errors.push(`${f.path}: contains a token-shaped string. Refusing to commit.`);
    }
  }
  if (errors.length > 0) throw new Error(`Validation failed: ${errors.join(' ')}`);
}

const lineCount = (s: string): number => (s.length === 0 ? 0 : s.split('\n').length);

/** Lines one proposed entry touches before it is applied: removed + added for edits. */
function entryLineCount(entry: FixOutput['files'][number]): number {
  return isEditEntry(entry)
    ? entry.edits.reduce((n, e) => n + lineCount(e.find) + lineCount(e.replace), 0)
    : lineCount(entry.contents);
}

function proposalLineCount(fix: FixOutput): number {
  return fix.files.reduce((n, f) => n + entryLineCount(f), 0);
}

/** GitHub code-search calls per dispatch (the endpoint allows ~10 a minute). */
const MAX_CODE_SEARCH_CALLS = 6;
/** A literal found in more files than this is not distinctive; its hits are ignored. */
const MAX_LITERAL_FILES = 15;
/** Files kept per literal. */
const FILES_PER_LITERAL = 5;

/** Escape LIKE wildcards (`%`, `_`) and the escape character itself. */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Index fallback for the literal search: files whose indexed text contains
 * the literal. Index previews are partial, so a miss proves nothing; a hit
 * is re-checked against the full file once it is read.
 */
async function indexFilesContaining(
  db: ReturnType<typeof getServiceClient>,
  projectId: string,
  literal: string,
): Promise<string[]> {
  const { data, error } = await db
    .from('project_codebase_files')
    .select('file_path')
    .eq('project_id', projectId)
    .is('tombstoned_at', null)
    .ilike('content_preview', `%${escapeLike(literal)}%`)
    .limit(60);
  if (error || !data) return [];
  const paths = [...new Set((data as Array<{ file_path: string }>).map((r) => r.file_path))];
  return paths.length > MAX_LITERAL_FILES ? [] : paths;
}

/** Index paths matching stack-frame paths by whole-segment suffix. */
async function indexPathsForFrames(
  db: ReturnType<typeof getServiceClient>,
  projectId: string,
  framePaths: readonly string[],
): Promise<string[]> {
  const out: string[] = [];
  for (const frame of framePaths.slice(0, 5)) {
    const { data, error } = await db
      .from('project_codebase_files')
      .select('file_path')
      .eq('project_id', projectId)
      .is('tombstoned_at', null)
      .ilike('file_path', `%${escapeLike(frame)}`)
      .limit(20);
    if (error || !data) continue;
    const paths = [...new Set((data as Array<{ file_path: string }>).map((r) => r.file_path))];
    for (const p of matchFramePathsToTree([frame], paths)) if (!out.includes(p)) out.push(p);
  }
  return out;
}

/**
 * The target repo's path globs and every other linked repo's, for
 * attributing project-wide index paths (see attributeIndexPath). The target
 * is the repo resolveRepo picked (target_repo_id hint, else the primary).
 * If project_repos cannot be read, every index path is treated as possibly
 * another repo's: it is used only after a read from the target repo finds
 * it, and its index preview is never shown.
 */
async function loadLinkedRepoScope(
  db: ReturnType<typeof getServiceClient>,
  projectId: string,
  repo: ResolvedRepo,
): Promise<LinkedRepoScope> {
  const { data, error } = await db
    .from('project_repos')
    .select('repo_url, path_globs')
    .eq('project_id', projectId);
  if (error || !data) return { targetGlobs: repo.pathGlobs, otherRepoGlobs: [null] };
  const isTarget = (url: string) => {
    const parsed = parseGithubUrl(url);
    return (
      parsed?.owner.toLowerCase() === repo.owner.toLowerCase() &&
      parsed?.repo.toLowerCase() === repo.repo.toLowerCase()
    );
  };
  const others = (data as Array<{ repo_url: string; path_globs: string[] | null }>)
    .filter((r) => !isTarget(r.repo_url))
    .map((r) => (r.path_globs && r.path_globs.length > 0 ? r.path_globs : null));
  return { targetGlobs: repo.pathGlobs, otherRepoGlobs: others };
}

/**
 * Step 3a: pick the files the model sees and read them whole at the base
 * commit. Candidates, strongest first: files containing a distinctive literal
 * from the report (GitHub code search, else the index), stack-frame files,
 * then RAG hits. See _shared/fix-context.ts for the caps and labels.
 */
async function assembleFullFileContext(
  db: ReturnType<typeof getServiceClient>,
  log: Logger,
  args: {
    projectId: string;
    report: Record<string, unknown>;
    repo: ResolvedRepo;
    ghToken: string | null;
    baseSha: string | null;
    ragFiles: CodeContext[];
  },
): Promise<FullFileContext & { literals: string[] }> {
  const { projectId, report, repo, ghToken, baseSha, ragFiles } = args;
  const { literals, framePaths } = extractReportLiterals(report);

  // The index is project-wide; in a multi-repo project its paths may belong
  // to a sibling repo (frontend and backend both owning `src/**`). Only the
  // target repo's files may be read or edited.
  const scope = await loadLinkedRepoScope(db, projectId, repo);
  const attribute = (path: string) => attributeIndexPath(path, scope);

  const literalHits = new Map<string, string[]>(); // code search on the target repo
  const indexLiteralHits = new Map<string, string[]>(); // project-wide index
  const addHit = (into: Map<string, string[]>, path: string, literal: string) => {
    const hits = into.get(path) ?? [];
    if (!hits.includes(literal)) hits.push(literal);
    into.set(path, hits);
  };
  let searchCalls = 0;
  let codeSearchUsable = Boolean(ghToken);
  // Each literal is tried as-is, then as stems for runtime-built strings
  // (`ota:manifest-504` → `manifest-`); the first term that finds files wins
  // and is the one verified against the full text.
  for (const literal of literals) {
    for (const term of literalSearchTerms(literal)) {
      let searched: string[] | null = null;
      if (ghToken && codeSearchUsable && searchCalls < MAX_CODE_SEARCH_CALLS) {
        searchCalls++;
        const found = await searchRepoCode(ghToken, repo.owner, repo.repo, term);
        if (found === null) codeSearchUsable = false; // rate limited / no access: stop asking
        else searched = found.totalCount > MAX_LITERAL_FILES ? [] : found.paths;
      }
      if (searched && searched.length > 0) {
        for (const p of searched.slice(0, FILES_PER_LITERAL)) addHit(literalHits, p, term);
        break;
      }
      let indexed: string[] = [];
      try {
        indexed = await indexFilesContaining(db, projectId, term);
      } catch {
        indexed = [];
      }
      if (indexed.length > 0) {
        for (const p of indexed.slice(0, FILES_PER_LITERAL)) addHit(indexLiteralHits, p, term);
        break;
      }
    }
  }

  // i18n hop: a literal found only in a translation file names a key; the
  // code that renders it uses the key, not the text (AppNudge.tsx says
  // t("readOnApp"), en/common.json holds "Read on the app").
  const localeHits = [...literalHits.entries(), ...indexLiteralHits.entries()]
    .filter(([path]) => isLocaleFile(path))
    .slice(0, 2);
  const keysSearched: string[] = [];
  if (ghToken && baseSha) {
    for (const [path, lits] of localeHits) {
      const state = await fetchBaseFileState(ghToken, repo.owner, repo.repo, baseSha, path);
      if (state.kind !== 'exists') continue;
      for (const lit of lits.slice(0, 2)) {
        for (const key of localeKeysForText(state.contents, lit, 2)) {
          if (keysSearched.includes(key)) continue;
          keysSearched.push(key);
          let users: string[] = [];
          if (codeSearchUsable && searchCalls < MAX_CODE_SEARCH_CALLS) {
            searchCalls++;
            const found = await searchRepoCode(ghToken, repo.owner, repo.repo, key);
            if (found === null) codeSearchUsable = false;
            else users = found.totalCount > MAX_LITERAL_FILES ? [] : found.paths;
          }
          if (users.length === 0) {
            try {
              users = await indexFilesContaining(db, projectId, key);
            } catch {
              users = [];
            }
          }
          for (const p of users.filter((u) => !isLocaleFile(u)).slice(0, FILES_PER_LITERAL)) {
            addHit(literalHits, p, key);
          }
        }
      }
    }
  }

  let frameRepoPaths: string[] = [];
  try {
    frameRepoPaths = await indexPathsForFrames(db, projectId, framePaths);
  } catch {
    frameRepoPaths = [];
  }
  // A frame path the index does not know may still be the repo path as-is
  // (bundlers that keep source paths); a guess that is absent is dropped.
  const unmatchedFrames = framePaths
    .filter((fp) => !frameRepoPaths.some((p) => p === fp || p.endsWith(`/${fp}`)))
    .filter((fp) => fp.includes('/'))
    .slice(0, 3);

  const candidates = rankContextCandidates({
    literalHits,
    indexLiteralHits,
    framePaths: unmatchedFrames.filter((p) => underRepoGlobs(p, scope.targetGlobs)),
    indexFramePaths: frameRepoPaths,
    rag: ragFiles,
    attribute,
  });
  const otherRepoPaths = [
    ...new Set([...ragFiles.map((f) => f.filePath), ...indexLiteralHits.keys(), ...frameRepoPaths]),
  ].filter((p) => attribute(p) === 'other');
  const readFile =
    ghToken && baseSha
      ? (path: string) => fetchBaseFileState(ghToken, repo.owner, repo.repo, baseSha, path)
      : null;
  const built = await buildFullFileContext(candidates, readFile, FULL_CONTEXT_LIMITS);

  log.info('fix context assembled', {
    literals,
    localeKeys: keysSearched,
    framePaths,
    codeSearchCalls: searchCalls,
    codeSearchUsable,
    candidates: candidates.length,
    linkedRepos: scope.otherRepoGlobs.length + 1,
    otherRepoPathsDropped: otherRepoPaths.slice(0, 10),
    shown: built.outcomes.filter((o) => o.shown === 'full').length,
    partial: built.outcomes.filter((o) => o.shown === 'preview' || o.shown === 'excerpt').length,
    omitted: built.outcomes.filter((o) => o.shown === 'omitted').map((o) => `${o.path}: ${o.reason}`).slice(0, 10),
  });
  return { ...built, literals };
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
  recipeBlock = '',
  /** Set when "Relevant code" holds whole files read at this commit (LLM path). */
  baseRef: { branch: string; sha: string } | null = null,
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

${
  baseRef
    ? `## Relevant Code
Read from ${repo.owner}/${repo.repo}@${baseRef.branch} (${baseRef.sha.slice(0, 7)}), the commit the PR branches from. A "(full file …)" block is the complete current file; the "  12 | " gutter is not part of it. "(preview only …)" and "(excerpt only …)" blocks are partial.

${codeContext || '(No code could be read — name the files you would need and set needsHumanReview=true.)'}`
    : `## Relevant Code (RAG-retrieved)
${codeContext || '(No code context retrieved — propose what files to look at and set needsHumanReview=true.)'}`
}

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
}${recipeBlock ? `\n${recipeBlock}` : ''}
## Your Task
Output a structured fix plan. Touch the minimum number of files. Match the existing code style. If you change behavior, add or update a test. If you are not confident, set needsHumanReview=true.${
  baseRef
    ? `
You have the full file: change only what is needed via find/replace edits, each \`find\` copied verbatim (no gutter) and unique in its file. Use \`contents\` only for a new file. Never rewrite a file you were not shown in full.`
    : ''
}`;
}

// ----------------------------------------------------------------------------
// GitHub PR creation via raw REST. Octokit doesn't run in Deno, but the
// Contents and Pulls APIs are simple JSON-over-HTTPS calls.
// ----------------------------------------------------------------------------


function buildPrBody(
  fix: { rationale: string; needsHumanReview: boolean; files: ReadonlyArray<{ path: string; reason: string }> },
  reportId: string,
): string {
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

${reportConsoleLink(reportId)}`;
}

/**
 * GitHub only links http(s) URLs, so the old custom-scheme report link was
 * dead text. ADMIN_BASE_URL is the console origin (team-notify uses the same
 * var); without it the line is left out rather than shipped broken.
 */
function reportConsoleLink(reportId: string): string {
  const adminBase = Deno.env.get('ADMIN_BASE_URL')?.replace(/\/$/, '') ?? null;
  return adminBase ? `[Open report in the Mushi console](${adminBase}/reports/${encodeURIComponent(reportId)})` : '';
}

