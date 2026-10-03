/**
 * V5.3 §2.3.4: GitHub App webhook handler for the RAG codebase indexer.
 *
 * - Verifies X-Hub-Signature-256 against the webhook secret (timing-safe).
 * - Mints a short-lived installation access token via the GitHub App private key.
 * - Diff-walks the push (added + modified + removed paths), pulls file
 *   contents via the contents API, chunks them, embeds, and upserts into
 *   project_codebase_files. Removed paths are tombstoned, not hard-deleted.
 *
 * Env required:
 *   GITHUB_APP_ID                — numeric App ID
 *   GITHUB_APP_PRIVATE_KEY       — PEM (no passphrase)
 *   GITHUB_APP_WEBHOOK_SECRET    — secret configured on the App
 */

import { Hono } from 'npm:hono@4';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { chunk, shouldIndex, sha256Hex } from '../_shared/code-indexer.ts';
import { createEmbedding, createEmbeddingBatch } from '../_shared/embeddings.ts';
import { log as rootLog } from '../_shared/logger.ts';
import { ensureSentry, sentryHonoErrorHandler } from '../_shared/sentry.ts';
import { requireServiceRoleAuth } from '../_shared/auth.ts';
import { unverifiedGithubInstallsAllowed } from '../_shared/github-install-trust.ts';
import { finalizeFixClosedUnmerged, finalizeFixMerge } from '../_shared/fix-merge.ts';
import { classifyIndexerError } from '../_shared/sweep-error-classifier.ts';
import { fetchRepoTreeWithBranchFallback, lookupBranchHeadSha } from '../_shared/github-branch.ts';
import { extractRelativeImports } from '../_shared/codebase-graph-build.ts';
import {
  chunkKey,
  planChunkWrites,
  pushBranchDecision,
  type PlannedChunk,
  type StoredChunk,
} from '../_shared/codebase-index-plan.ts';
import { envInt } from '../_shared/env-int.ts';
import {
  DEFAULT_SWEEP_RUN_FILES,
  INDEX_FILE_CAP_ENV,
  MAX_INDEXED_FILE_BYTES,
  isStorableBlob,
  indexFileCapForPlan,
  measureIndexCoverage,
  selectSweepFiles,
  sweepBookkeeping,
  type IndexCoverage,
  type IndexFileCap,
} from '../_shared/index-coverage.ts';
import { resolveProjectPlan } from '../_shared/quota.ts';
import {
  framePathsFromStackText,
  matchFramePathsToTree,
  normalizeFramePath,
} from '../_shared/sentry-frames.ts';
import { createWebhookMiddleware, ReplayAttackError, RateLimitError } from '../_shared/webhook-middleware.ts';
import {
  DISPATCHABLE_CLOUD_AGENTS,
  applyCloudAgentOutcome,
  parseCloudAgentBranchRef,
} from '../_shared/agent-adapters.ts';

ensureSentry('webhooks-github-indexer');

const log = rootLog.child('webhooks-github-indexer');
const app = new Hono();
app.onError(sentryHonoErrorHandler);

function getDb() {
  return createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false } },
  );
}

async function verifySignature(req: Request, raw: string): Promise<boolean> {
  const secret = Deno.env.get('GITHUB_APP_WEBHOOK_SECRET');
  if (!secret) return false;
  const sig = req.headers.get('X-Hub-Signature-256') ?? '';
  if (!sig.startsWith('sha256=')) return false;
  const expected = await hmacSha256Hex(secret, raw);
  return timingSafeEqual(sig.slice(7), expected);
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

/**
 * Mint a JWT for the App, exchange for an installation token. JWTs are tiny —
 * we sign in-process via Web Crypto rather than pulling jose into the bundle.
 */
async function mintInstallationToken(installationId: number): Promise<string> {
  const appId = Deno.env.get('GITHUB_APP_ID');
  const pem = Deno.env.get('GITHUB_APP_PRIVATE_KEY');
  if (!appId || !pem) throw new Error('GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY required');

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = { iat: now - 30, exp: now + 540, iss: appId };
  const enc = (obj: unknown) =>
    btoa(JSON.stringify(obj)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  const data = `${enc(header)}.${enc(payload)}`;

  const key = await importPkcs8(pem);
  const sig = await crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5' },
    key,
    new TextEncoder().encode(data),
  );
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
  const jwt = `${data}.${sigB64}`;

  const res = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    },
  );
  if (!res.ok) throw new Error(`installation token mint failed: ${res.status}`);
  const body = (await res.json()) as { token: string };
  return body.token;
}

async function importPkcs8(pem: string): Promise<CryptoKey> {
  const stripped = pem
    .replace(/-----BEGIN [A-Z ]+-----/, '')
    .replace(/-----END [A-Z ]+-----/, '')
    .replace(/\s+/g, '');
  const der = Uint8Array.from(atob(stripped), (c) => c.charCodeAt(0));
  return await crypto.subtle.importKey(
    'pkcs8',
    der,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

/**
 * Encode a repo-relative file path for the GitHub Contents API. Each segment
 * is percent-encoded independently so characters like `#` or spaces are escaped
 * but the path separators stay as literal `/` — `encodeURIComponent` on the
 * whole string would convert `/` to `%2F` and turn every subdirectory file
 * into a 404.
 */
function encodeRepoPath(path: string): string {
  return path
    .split('/')
    .filter((seg) => seg.length > 0)
    .map(encodeURIComponent)
    .join('/');
}

/**
 * One file's text at `ref`. `unstorable` (gone, empty, over the size limit)
 * can never be indexed; `error` is transient and retried by the next sweep.
 */
async function fetchFileForIndex(
  token: string,
  owner: string,
  repo: string,
  path: string,
  ref: string,
): Promise<{ text: string } | { skip: 'unstorable' | 'error' }> {
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${encodeRepoPath(path)}?ref=${encodeURIComponent(ref)}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.raw',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    },
  );
  if (res.status === 404) return { skip: 'unstorable' };
  if (!res.ok) {
    log.warn('contents fetch failed', { path, status: res.status });
    return { skip: 'error' };
  }
  const text = await res.text();
  if (text.length === 0 || text.length > MAX_INDEXED_FILE_BYTES) return { skip: 'unstorable' };
  return { text };
}

async function fetchFileContents(
  token: string,
  owner: string,
  repo: string,
  path: string,
  ref: string,
): Promise<string | null> {
  const got = await fetchFileForIndex(token, owner, repo, path, ref);
  return 'text' in got ? got.text : null;
}

app.get('/webhooks-github-indexer/health', (c) => c.json({ ok: true }));

/**
 * Append one row to `fix_events` for a given fix_attempt. Idempotent via
 * `dedupe_key` — re-delivered GitHub webhooks won't duplicate.
 *
 * This is a best-effort observability write: if it fails we just log and
 * move on, because the downstream endpoint will still synthesise a
 * (lower-fidelity) timeline from the columns on `fix_attempts` itself.
 */
async function emitFixEvent(
  db: ReturnType<typeof getDb>,
  row: {
    fix_attempt_id: string;
    project_id: string;
    kind:
      | 'dispatched'
      | 'started'
      | 'branch'
      | 'commit'
      | 'pr_opened'
      | 'ci_started'
      | 'ci_resolved'
      | 'pr_state_changed'
      | 'completed'
      | 'failed';
    status?: 'ok' | 'fail' | 'pending' | null;
    label: string;
    detail?: string | null;
    at?: string | null;
    dedupe_key?: string | null;
    payload?: Record<string, unknown> | null;
  },
): Promise<void> {
  const { error } = await db.from('fix_events').insert({
    fix_attempt_id: row.fix_attempt_id,
    project_id: row.project_id,
    kind: row.kind,
    status: row.status ?? null,
    label: row.label,
    detail: row.detail ?? null,
    at: row.at ?? new Date().toISOString(),
    dedupe_key: row.dedupe_key ?? null,
    payload: row.payload ?? null,
  });
  if (error) {
    // Unique-violation on dedupe_key is expected on retries — don't warn.
    if (error.code !== '23505') {
      log.warn('fix_events insert failed (non-fatal)', { err: error.message, kind: row.kind });
    }
  }
}

/**
 * Handle every `pull_request.*` action we care about for the fix graph:
 * opened / reopened / ready_for_review / converted_to_draft / closed.
 * Updates `fix_attempts.pr_state` and emits one `pr_state_changed` event per
 * webhook so the graph can show the full lifecycle (draft -> open -> merged).
 * Merges still fall through to the billing-specific handler below.
 */
/**
 * Cloud-agent fallback for `pull_request` webhooks whose PR is not yet on any
 * `fix_attempts.pr_url`: Cursor Cloud / GitHub cloud-agent PRs are opened by
 * the VENDOR, so the first `pull_request.opened` delivery usually beats the
 * poller. Match the head ref against `fix_attempts.branch_name` (the branch
 * the fix-worker asked for, or the head_ref the poller learned) and then
 * against the `MUSHI-<report uuid>-<cursor-cloud|github-agent>` pattern that
 * generateCursorCloudBranchName produces. Only attempts that still have no
 * PR and belong to a cloud agent qualify.
 */
async function matchCloudAttemptByHeadRef(
  db: ReturnType<typeof getDb>,
  headRef: string,
): Promise<{ id: string; project_id: string; report_id: string; agent: string } | null> {
  const cloudKinds = [...DISPATCHABLE_CLOUD_AGENTS];
  const { data: byBranch } = await db
    .from('fix_attempts')
    .select('id, project_id, report_id, agent')
    .eq('branch_name', headRef)
    .is('pr_url', null)
    .in('agent', cloudKinds)
    .order('started_at', { ascending: false })
    .limit(1);
  if (byBranch && byBranch.length > 0) return byBranch[0];

  const parsed = parseCloudAgentBranchRef(headRef);
  if (!parsed) return null;
  const { data: byReport } = await db
    .from('fix_attempts')
    .select('id, project_id, report_id, agent')
    .eq('report_id', parsed.reportId)
    .is('pr_url', null)
    .in('agent', cloudKinds)
    .in('status', ['running', 'queued'])
    .order('started_at', { ascending: false })
    .limit(1);
  return byReport && byReport.length > 0 ? byReport[0] : null;
}

async function handlePullRequestState(
  payload: {
    action?: string;
    pull_request?: {
      merged?: boolean;
      html_url?: string;
      number?: number;
      draft?: boolean;
      state?: string;
      closed_at?: string | null;
      delivery_id?: string;
      head?: { ref?: string };
    };
    repository?: { full_name?: string };
  },
  deliveryId: string,
): Promise<Response> {
  const prUrl = payload.pull_request?.html_url;
  if (!prUrl)
    return new Response(JSON.stringify({ ok: true, ignored: 'no_pr_url' }), { status: 202 });

  const db = getDb();
  let { data: attempt } = await db
    .from('fix_attempts')
    .select('id, project_id, report_id, agent, branch, commit_sha, pr_url, pr_number, merged_at, pr_state')
    .eq('pr_url', prUrl)
    .maybeSingle();
  if (!attempt) {
    // Cloud-agent fallback: match by head ref while pr_url is still NULL.
    // applyCloudAgentOutcome guards on pr_url IS NULL at write time, so a
    // poller tick / v0 webhook racing this delivery still yields exactly one
    // PR write and one 'fix_pr_opened' notification.
    const headRef = payload.pull_request?.head?.ref ?? null;
    const isOpening =
      payload.action === 'opened' || payload.action === 'reopened' || payload.action === 'ready_for_review';
    const cloudAttempt = headRef && isOpening ? await matchCloudAttemptByHeadRef(db, headRef) : null;
    if (!cloudAttempt) {
      return new Response(
        JSON.stringify({ ok: true, ignored: 'pr_not_a_mushi_fix', pr_url: prUrl }),
        { status: 202, headers: { 'Content-Type': 'application/json' } },
      );
    }
    const applied = await applyCloudAgentOutcome(
      db,
      {
        attemptId: cloudAttempt.id,
        projectId: cloudAttempt.project_id,
        reportId: cloudAttempt.report_id,
        agent: cloudAttempt.agent,
      },
      { kind: 'pr_opened', prUrl, branch: headRef },
    );
    log.info('cloud-agent PR matched by head ref', {
      fixAttemptId: cloudAttempt.id,
      agent: cloudAttempt.agent,
      headRef,
      prUrl,
      applied: applied.applied,
      reason: applied.reason ?? null,
    });
    // Re-read by pr_url so the pr_state bookkeeping below runs on the row
    // that now owns this PR (ours, or the one that won the race).
    const reread = await db
      .from('fix_attempts')
      .select('id, project_id, report_id, agent, branch, commit_sha, pr_url, pr_number, merged_at, pr_state')
      .eq('pr_url', prUrl)
      .maybeSingle();
    attempt = reread.data;
    if (!attempt) {
      return new Response(
        JSON.stringify({ ok: true, matched_by: 'head_ref', applied: applied.applied, reason: applied.reason ?? null }),
        { status: 202, headers: { 'Content-Type': 'application/json' } },
      );
    }
  }

  // Derive the new lifecycle state.
  let newState: 'open' | 'closed' | 'merged' | 'draft';
  if (payload.pull_request?.merged) newState = 'merged';
  else if (payload.pull_request?.state === 'closed') newState = 'closed';
  else if (payload.pull_request?.draft) newState = 'draft';
  else newState = 'open';

  // Closed without merge: shared bookkeeping (pr_state, one "PR closed
  // without merge" event, report back out of 'fixing') so ci-sync and this
  // webhook agree and never double-emit.
  if (newState === 'closed') {
    const closed = await finalizeFixClosedUnmerged(db, attempt, {
      prNumber: payload.pull_request?.number ?? null,
      closedAt: payload.pull_request?.closed_at ?? null,
      source: 'webhook',
    });
    return new Response(
      JSON.stringify({ ok: true, fix_attempt_id: attempt.id, pr_state: newState, report_status: closed.reportStatus }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  if (attempt.pr_state !== newState) {
    await db.from('fix_attempts').update({ pr_state: newState }).eq('id', attempt.id);
  }

  await emitFixEvent(db, {
    fix_attempt_id: attempt.id,
    project_id: attempt.project_id,
    kind: 'pr_state_changed',
    status: newState === 'merged' ? 'ok' : 'pending',
    label: `PR ${newState}`,
    detail: `#${payload.pull_request?.number ?? '—'}`,
    dedupe_key: `pr:${deliveryId}`,
    payload: { action: payload.action, state: newState },
  });

  // If this is a merge, delegate to the existing billing handler so we still
  // record the `fixes_succeeded` usage_event.
  if (newState === 'merged') {
    return await handleFixPrMerged(payload);
  }

  return new Response(
    JSON.stringify({ ok: true, fix_attempt_id: attempt.id, pr_state: newState }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

/**
 * Handle `check_run.*` events. Emits a `ci_started` (pending) or
 * `ci_resolved` (ok/fail) event for every check run attached to a PR branch
 * we're tracking. We also keep `fix_attempts.check_run_status` /
 * `check_run_conclusion` up to date so the legacy synth path in the
 * timeline endpoint stays consistent for pre-`fix_events` attempts.
 */
async function handleCheckRun(
  payload: {
    action?: string;
    check_run?: {
      id?: number;
      name?: string;
      status?: string;
      conclusion?: string | null;
      completed_at?: string | null;
      started_at?: string | null;
      html_url?: string | null;
      head_sha?: string | null;
      pull_requests?: Array<{ head?: { ref?: string } }>;
    };
    repository?: { full_name?: string };
  },
  deliveryId: string,
): Promise<Response> {
  const run = payload.check_run;
  if (!run)
    return new Response(JSON.stringify({ ok: true, ignored: 'no_check_run' }), { status: 202 });

  const headRef = run.pull_requests?.[0]?.head?.ref;
  const headSha = run.head_sha;
  if (!headRef && !headSha) {
    return new Response(JSON.stringify({ ok: true, ignored: 'check_run_no_ref' }), { status: 202 });
  }

  const db = getDb();
  // Prefer matching by branch name; fall back to commit SHA for CI runs
  // that only report a detached head.
  const q = db.from('fix_attempts').select('id, project_id');
  const { data: attempt } = await (headRef
    ? q.eq('branch', headRef).maybeSingle()
    : q.eq('commit_sha', headSha).maybeSingle());
  if (!attempt) {
    return new Response(
      JSON.stringify({ ok: true, ignored: 'check_not_a_mushi_fix', headRef, headSha }),
      { status: 202, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const status = (run.status ?? '').toLowerCase();
  const conclusion = (run.conclusion ?? '').toLowerCase();
  const resolved = conclusion.length > 0;

  await db
    .from('fix_attempts')
    .update({
      check_run_status: status || null,
      check_run_conclusion: conclusion || null,
      check_run_updated_at: new Date().toISOString(),
    })
    .eq('id', attempt.id);

  await emitFixEvent(db, {
    fix_attempt_id: attempt.id,
    project_id: attempt.project_id,
    kind: resolved ? 'ci_resolved' : 'ci_started',
    status: resolved ? (conclusion === 'success' ? 'ok' : 'fail') : 'pending',
    label: resolved ? `CI ${conclusion}` : `CI ${status.replace(/_/g, ' ') || 'running'}`,
    detail: run.name ?? null,
    at: run.completed_at ?? run.started_at ?? new Date().toISOString(),
    dedupe_key: `check_run:${run.id ?? deliveryId}:${resolved ? 'done' : 'start'}`,
    payload: { name: run.name, url: run.html_url },
  });

  return new Response(
    JSON.stringify({ ok: true, fix_attempt_id: attempt.id, ci: resolved ? conclusion : status }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

/**
 * Emit a `commit` fix_event for every push to a branch that matches a
 * known fix_attempt. Multi-commit pushes on the same agent branch (e.g.
 * "fix lint, then fix types") each get their own row so the timeline can
 * render the progression. Safe to call even when no fix_attempt matches.
 */
async function emitCommitEventsForPush(
  db: ReturnType<typeof getDb>,
  payload: {
    ref?: string;
    commits?: Array<{
      id?: string;
      message?: string;
      timestamp?: string;
      added?: string[];
      modified?: string[];
      removed?: string[];
    }>;
    head_commit?: { id?: string; timestamp?: string };
  },
  deliveryId: string,
): Promise<void> {
  const branch = (payload.ref ?? '').replace(/^refs\/heads\//, '');
  if (!branch || !payload.commits?.length) return;

  const { data: attempt } = await db
    .from('fix_attempts')
    .select('id, project_id, commit_sha')
    .eq('branch', branch)
    .maybeSingle();
  if (!attempt) return;

  for (const commit of payload.commits) {
    if (!commit.id) continue;
    const changedCount =
      (commit.added?.length ?? 0) + (commit.modified?.length ?? 0) + (commit.removed?.length ?? 0);
    await emitFixEvent(db, {
      fix_attempt_id: attempt.id,
      project_id: attempt.project_id,
      kind: 'commit',
      status: 'ok',
      label: `Commit ${commit.id.slice(0, 7)}`,
      detail: commit.message?.split('\n')[0]?.slice(0, 140) ?? `${changedCount} files`,
      at: commit.timestamp ?? new Date().toISOString(),
      dedupe_key: `commit:${commit.id}`,
      payload: { files: changedCount },
    });
  }

  // Keep the canonical commit_sha pointing at HEAD of the push so the
  // report-detail chip + diff modal link-out land on the latest commit.
  if (payload.head_commit?.id && payload.head_commit.id !== attempt.commit_sha) {
    await db
      .from('fix_attempts')
      .update({ commit_sha: payload.head_commit.id })
      .eq('id', attempt.id);
  }
  // deliveryId is kept in the dedupe_key for branches where the head_commit
  // isn't known (rare — GitHub always sets head_commit on push events).
  void deliveryId;
}

/**
 * Handle a `pull_request.closed` event with `merged: true`.
 *
 * Looks up the `fix_attempts` row whose `pr_url` matches the merged PR — if
 * it's one of ours, append a `fixes_succeeded` usage_event so the aggregator
 * pushes it to Stripe Meter Events on the next tick. Idempotent: a `pr_url`
 * unique constraint on the metadata field would be ideal, but for now we
 * `select first` and bail if a `fixes_succeeded` event already exists for
 * the same PR. This is best-effort billing — we never 500 on a billing
 * write so GitHub doesn't retry the webhook for non-billing reasons.
 */
async function handleFixPrMerged(payload: {
  pull_request?: { html_url?: string; number?: number };
  repository?: { full_name?: string };
}): Promise<Response> {
  const prUrl = payload.pull_request?.html_url;
  if (!prUrl)
    return new Response(JSON.stringify({ ok: true, ignored: 'no_pr_url' }), { status: 202 });

  const db = getDb();
  const { data: attempt } = await db
    .from('fix_attempts')
    .select(
      'id, project_id, report_id, agent, branch, commit_sha, pr_url, pr_number, merged_at, summary, rationale, files_changed',
    )
    .eq('pr_url', prUrl)
    .maybeSingle();

  if (!attempt) {
    return new Response(
      JSON.stringify({ ok: true, ignored: 'pr_not_a_mushi_fix', pr_url: prUrl }),
      { status: 202, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const { justMerged } = await finalizeFixMerge(db, attempt, {
    prUrl,
    prNumber: payload.pull_request?.number,
    repository: payload.repository?.full_name,
  });

  if (justMerged) {
    try {
      await indexFixIntoCorpus(db, attempt, prUrl);
    } catch (err) {
      log.warn('fix_corpus indexing failed (non-fatal)', {
        fix_attempt_id: attempt.id,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return new Response(
    JSON.stringify({
      ok: true,
      justMerged,
      fix_attempt_id: attempt.id,
      project_id: attempt.project_id,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

/**
 * Loop-closure helper: turn a merged fix_attempt into a `fix_corpus` row
 * that the fix-worker can retrieve as "past similar fixes" context for
 * future PDCA cycles. This is the highest-quality teaching example we
 * can produce — a real bug, a real diff, validated by a human merge.
 *
 * Idempotency: caller already gates on `justMerged`; on top of that we
 * `select existing → bail` so a manual re-trigger (e.g. operator running
 * the webhook test endpoint) doesn't double-index. Embedding cost is
 * paid once per unique merge.
 *
 * The bug summary comes from `reports.summary` (set by the classify
 * worker) so the embedding reflects what the user *meant*, not what the
 * fix authors wrote — the goal is "find me a fix for this NEW bug that
 * looks like an OLD bug we already fixed", which is symmetric on the
 * report side.
 */
async function indexFixIntoCorpus(
  db: ReturnType<typeof getDb>,
  attempt: {
    id: string;
    project_id: string;
    report_id: string;
    summary: string | null;
    rationale: string | null;
    files_changed: string[] | null;
  },
  _prUrl: string,
): Promise<void> {
  // Bail if we already indexed this fix.
  const { data: existing } = await db
    .from('fix_corpus')
    .select('id')
    .eq('fix_attempt_id', attempt.id)
    .maybeSingle();
  if (existing) return;

  const { data: report } = await db
    .from('reports')
    .select('summary, description')
    .eq('id', attempt.report_id)
    .maybeSingle();

  const bugSummary =
    (report?.summary && String(report.summary).trim()) ||
    (report?.description && String(report.description).slice(0, 240).trim()) ||
    '(no report summary)';
  const fixSummary = (attempt.summary && String(attempt.summary).trim()) || '(no fix summary)';
  const rationale = (attempt.rationale && String(attempt.rationale).trim()) || null;

  // Truncate to fit text-embedding-3-small's 8191-token window. Practical
  // cap: ~7000 chars keeps us well under the limit even with multibyte
  // characters and lets the bug + fix + rationale all carry weight.
  const embeddingInput = [
    `Bug: ${bugSummary}`,
    `Fix: ${fixSummary}`,
    rationale ? `Rationale: ${rationale}` : null,
    Array.isArray(attempt.files_changed) && attempt.files_changed.length > 0
      ? `Files: ${attempt.files_changed.slice(0, 20).join(', ')}`
      : null,
  ]
    .filter(Boolean)
    .join('\n')
    .slice(0, 7000);

  let embedding: number[] | null = null;
  try {
    embedding = await createEmbedding(embeddingInput, { projectId: attempt.project_id });
  } catch (err) {
    // Non-fatal — we still insert the row sans embedding so the audit
    // trail is intact; a backfill cron can re-embed later.
    log.warn('fix_corpus embedding failed (will insert without)', {
      fix_attempt_id: attempt.id,
      err: err instanceof Error ? err.message : String(err),
    });
  }

  const { error } = await db.from('fix_corpus').insert({
    project_id: attempt.project_id,
    fix_attempt_id: attempt.id,
    report_id: attempt.report_id,
    bug_summary: bugSummary.slice(0, 1000),
    fix_summary: fixSummary.slice(0, 1000),
    rationale: rationale ? rationale.slice(0, 4000) : null,
    files_changed: Array.isArray(attempt.files_changed) ? attempt.files_changed : [],
    embedding_input: embeddingInput,
    embedding: embedding ?? null,
    embedding_model: 'text-embedding-3-small',
    merged_at: new Date().toISOString(),
  });

  if (error) {
    log.warn('fix_corpus insert failed', {
      fix_attempt_id: attempt.id,
      err: error.message,
    });
  }
}

/**
 * Resolve a GitHub token for a project. Preference order:
 *   1. `project_settings.github_installation_token_ref` (PAT in vault or raw)
 *   2. `organization_integration_settings.github_installation_token_ref` (org default)
 *   3. `GITHUB_TOKEN` env fallback (self-host / founder dogfood)
 * Returns null if nothing resolves. Callers that prefer App installs should
 * call `mintInstallationToken` first and fall through to this helper.
 */
async function resolveProjectGithubToken(
  db: ReturnType<typeof getDb>,
  projectId: string,
): Promise<string | null> {
  const resolveRef = async (ref: string): Promise<string | null> => {
    if (ref.startsWith('vault://')) {
      const id = ref.slice('vault://'.length);
      const { data: secret, error: vaultErr } = await db.rpc('vault_get_secret', { secret_id: id });
      return !vaultErr && typeof secret === 'string' && secret.length > 0 ? secret : null;
    }
    return ref.length > 0 ? ref : null;
  };

  // Step 1: project-level.
  const { data, error } = await db
    .from('project_settings')
    .select('github_installation_token_ref')
    .eq('project_id', projectId)
    .maybeSingle();

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

  // Step 3: env fallback.
  return Deno.env.get('GITHUB_TOKEN') ?? null;
}

/**
 * Sweep mode: invoked hourly by pg_cron (see migration
 * 20260418003200_repo_indexer_cron.sql). Re-indexes every project_repos row
 * whose last sweep (`index_swept_at`) is older than `staleAfterHours`
 * (default 24h), never swept, or whose coverage is still `filling` (a
 * capped run that later runs will extend). Oldest attempt first, so a big
 * repo that is filling cannot hold a batch slot every hour.
 *
 * Authenticated via Authorization: Bearer <service_role_key>; we never accept
 * external sweep requests.
 *
 * Token resolution prefers a GitHub App install (`github_app_installation_id`
 * on the row) but falls back to the project's PAT stored in
 * `project_settings.github_installation_token_ref` so repos can be indexed
 * without going through the App flow.
 */
async function handleSweep(
  req: Request,
  parsedBody: { project_id?: string; frame_paths?: unknown } | null,
): Promise<Response> {
  // Accept either the auto-injected SUPABASE_SERVICE_ROLE_KEY (edge-to-edge
  // calls) or MUSHI_INTERNAL_CALLER_SECRET (pg_cron → pg_net callers, which
  // cannot read the reserved Supabase env var). See packages/server/README.md
  // §"Internal-caller authentication" for the rationale.
  const unauthorized = requireServiceRoleAuth(req);
  if (unauthorized) return unauthorized;

  const db = getDb();
  const staleAfterHours = envInt('MUSHI_REPO_INDEX_STALE_HOURS', 24, { min: 1 });
  const cutoff = new Date(Date.now() - staleAfterHours * 3_600_000).toISOString();
  const limit = envInt('MUSHI_REPO_INDEX_SWEEP_BATCH', 5, { min: 1, max: 100 });

  // Optional body filter: `{ mode:'sweep', project_id? }` scopes the sweep to a
  // single project (used by the new `/v1/admin/projects/:id/codebase/enable`
  // endpoint to index-now without blocking the whole hourly batch).
  let scopedProjectId: string | null = null;
  if (parsedBody?.project_id && /^[0-9a-f-]{36}$/i.test(parsedBody.project_id)) {
    scopedProjectId = parsedBody.project_id;
  }

  let query = db
    .from('project_repos')
    .select('id, project_id, repo_url, default_branch, github_app_installation_id, last_indexed_at, index_file_cap')
    .eq('indexing_enabled', true);

  // `{ mode:'sweep', project_id, frame_paths }` (from the Sentry import
  // route) embeds only the files those stack frames name — a few files, not
  // a full sweep — and leaves the repo's sweep bookkeeping alone.
  const targetFramePaths = scopedProjectId ? parseTargetFramePaths(parsedBody?.frame_paths) : [];

  if (scopedProjectId) {
    query = query.eq('project_id', scopedProjectId);
  } else {
    query = query
      .or(
        `index_swept_at.is.null,index_swept_at.lt.${cutoff},` +
          'index_coverage_state.is.null,index_coverage_state.eq.filling',
      )
      .order('last_index_attempt_at', { ascending: true, nullsFirst: true })
      .limit(limit);
  }

  const { data: repos, error } = await query;

  if (error) {
    log.error('sweep: project_repos query failed', { error: error.message });
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // The per-repo sweep is CPU+IO bound (tree walk + per-file contents +
  // OpenAI embeddings) and with batch > 1 easily exceeds the 150s Edge
  // Function idle timeout — which is why the hourly cron was logging
  // `504 IDLE_TIMEOUT` instead of completing. The hourly cron fires-and-
  // forgets (it never reads the response body), so for the unscoped
  // (no `project_id`) path we detach via `EdgeRuntime.waitUntil` and
  // return 202 immediately. The runtime keeps the worker alive until the
  // background promise resolves, independent of the request's idle timer.
  //
  // Scoped-per-project calls (admin UI "Index now" button) still run
  // inline because the UI waits for the response to refresh the repo's
  // last_indexed_at chip, and single-repo sweeps almost always fit inside
  // 150s.
  const runSweep = async (): Promise<Array<{ repo: string; ok: boolean; error?: string }>> => {
    const summary: Array<{ repo: string; ok: boolean; error?: string }> = [];
    for (const repo of repos ?? []) {
      const [owner, name] = String(repo.repo_url).split('/').slice(-2);
      if (!owner || !name) {
        summary.push({ repo: repo.repo_url, ok: false, error: 'bad_repo_url' });
        continue;
      }

      let token: string | null = null;
      try {
        // Stored installation ids are not verified yet (github-install-trust.ts).
        token = repo.github_app_installation_id && unverifiedGithubInstallsAllowed()
          ? await mintInstallationToken(Number(repo.github_app_installation_id))
          : await resolveProjectGithubToken(db, repo.project_id);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.warn('sweep: App install token mint failed; falling back to PAT', {
          repo: repo.repo_url,
          error: msg,
        });
        token = await resolveProjectGithubToken(db, repo.project_id);
      }

      if (!token) {
        summary.push({ repo: repo.repo_url, ok: false, error: 'no_token' });
        await db
          .from('project_repos')
          .update({
            last_index_attempt_at: new Date().toISOString(),
            last_index_error:
              'no_token: neither github_app_installation_id nor project_settings.github_installation_token_ref resolved',
          })
          .eq('id', repo.id);
        continue;
      }

      try {
        const fileCap = targetFramePaths.length > 0
          ? null
          : await projectIndexFileCap(db, repo.project_id, (repo as { index_file_cap?: number | null }).index_file_cap ?? null);
        const stats = await sweepIndexRepo(
          db,
          repo.project_id,
          token,
          owner,
          name,
          repo.default_branch ?? 'main',
          { targetFramePaths, fileCap },
        );
        if (targetFramePaths.length > 0) {
          log.info('sweep: frame-path index', { repo: repo.repo_url, ...stats });
          summary.push({ repo: repo.repo_url, ok: stats.inserted > 0 || stats.failed === 0, ...stats });
          continue;
        }
        if (stats.inserted === 0 && stats.failed > 0) {
          const msg = stats.lastError ?? 'all chunk embeddings failed';
          const kind = classifyIndexerError(msg);
          // Auth / permission / transient errors are operator-config or
          // upstream issues — surface via `last_index_error` (admin UI
          // shows it) and a structured `log.warn` so we don't generate a
          // recurring Sentry Issue (regression history: MUSHI-MUSHI-SERVER-B).
          if (kind === 'unknown') {
            log.error('sweep: repo index failed', {
              repo: repo.repo_url,
              error: msg,
              failed: stats.failed,
              skipped: stats.skipped,
              kind,
            });
          } else {
            log.warn('sweep: repo index skipped', {
              repo: repo.repo_url,
              error: msg,
              failed: stats.failed,
              skipped: stats.skipped,
              kind,
            });
          }
          await db
            .from('project_repos')
            .update({
              last_index_attempt_at: new Date().toISOString(),
              last_index_error: msg.slice(0, 500),
              // The tree fetch on GitHub's default branch did succeed, so the
              // branch truth is known even though embeddings failed.
              ...(stats.correctedBranch ? { default_branch: stats.correctedBranch } : {}),
            })
            .eq('id', repo.id);
          summary.push({ repo: repo.repo_url, ok: false, error: msg });
        } else {
          // project_repos.commit_sha / indexed_branch feed impact-resolve and
          // the radar's index checks. A failed write is reported, not hidden.
          // Coverage (gap #16a): last_indexed_at moves only when every
          // eligible file is indexed; a partial sweep records its coverage
          // and index_swept_at, and stays in the hourly batch while filling.
          if (!stats.coverage) throw new Error('sweep finished without a coverage measurement');
          const { error: bookkeepingErr } = await db
            .from('project_repos')
            .update({
              indexed_branch: stats.branch,
              ...(stats.headSha ? { commit_sha: stats.headSha } : {}),
              ...sweepBookkeeping({
                coverage: stats.coverage,
                nowIso: new Date().toISOString(),
                failedChunks: stats.failed,
                lastError: stats.lastError,
              }),
              // Persist the branch GitHub actually serves so the next sweep,
              // the fix-worker base and the console all agree.
              ...(stats.correctedBranch ? { default_branch: stats.correctedBranch } : {}),
            })
            .eq('id', repo.id);
          if (bookkeepingErr) {
            log.error('sweep: project_repos update failed', { repo: repo.repo_url, error: bookkeepingErr.message });
            summary.push({ repo: repo.repo_url, ok: false, error: `project_repos update failed: ${bookkeepingErr.message}` });
            continue;
          }
          summary.push({ repo: repo.repo_url, ok: true, ...stats });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const kind = classifyIndexerError(err);
        // See classifyIndexerError docblock for routing rationale (Sentry
        // MUSHI-MUSHI-SERVER-B regression history).
        if (kind === 'unknown') {
          log.error('sweep: repo index failed', { repo: repo.repo_url, error: msg, kind });
        } else {
          log.warn('sweep: repo index skipped', { repo: repo.repo_url, error: msg, kind });
        }
        await db
          .from('project_repos')
          .update({
            last_index_attempt_at: new Date().toISOString(),
            last_index_error: msg.slice(0, 500),
          })
          .eq('id', repo.id);
        summary.push({ repo: repo.repo_url, ok: false, error: msg });
      }
    }
    return summary;
  };

  const ranOutOfBand = !scopedProjectId;
  const edgeRuntime = (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } })
    .EdgeRuntime;
  if (ranOutOfBand && edgeRuntime && typeof edgeRuntime.waitUntil === 'function') {
    edgeRuntime.waitUntil(
      runSweep().catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        log.error('sweep: background task crashed', { error: msg });
      }),
    );
    return new Response(
      JSON.stringify({ ok: true, queued: repos?.length ?? 0, mode: 'background' }),
      { status: 202, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const summary = await runSweep();
  return new Response(JSON.stringify({ ok: true, swept: summary.length, results: summary }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Index every indexable file at HEAD for `ref`. Used by sweep mode for repos
 * that have never been indexed (or are stale). Push events stick with the
 * narrower diff-walk path because it's much cheaper.
 *
 * Accepts an already-resolved bearer token so the caller can choose between
 * a GitHub App installation token and a user PAT. Both authenticate the same
 * read-only `tree` + `contents` endpoints used below.
 */
interface IndexChunk extends PlannedChunk {
  chunk: ReturnType<typeof chunk>[number];
  text: string;
}

/** Chunk one file, hashing each chunk and extracting the whole file's imports up front. */
async function chunksForFile(path: string, source: string): Promise<IndexChunk[]> {
  const imports = extractRelativeImports(source);
  const out: IndexChunk[] = [];
  for (const ch of chunk(path, source)) {
    out.push({
      path,
      symbolName: ch.symbolName,
      hash: await sha256Hex(ch.body),
      imports,
      chunk: ch,
      text: `${path}::${ch.symbolName ?? 'whole'}\n${ch.body}`,
    });
  }
  return out;
}

/**
 * Stored chunks for `paths` that already have an embedding. A failed read
 * throws: guessing "nothing stored" would re-embed everything, guessing
 * "all stored" would skip changed code.
 */
async function loadStoredChunks(
  db: ReturnType<typeof getDb>,
  projectId: string,
  paths: string[],
): Promise<Map<string, StoredChunk>> {
  const stored = new Map<string, StoredChunk>();
  for (let i = 0; i < paths.length; i += 50) {
    const { data, error } = await db
      .from('project_codebase_files')
      .select('file_path, symbol_name, content_hash, imports, tombstoned_at')
      .eq('project_id', projectId)
      .in('file_path', paths.slice(i, i + 50))
      .not('embedding', 'is', null);
    if (error) throw new Error(`stored chunk lookup failed: ${error.message}`);
    for (const r of (data ?? []) as Array<StoredChunk & { file_path: string; symbol_name: string | null }>) {
      stored.set(chunkKey(r.file_path, r.symbol_name), r);
    }
  }
  return stored;
}

/** Row columns for a chunk, without the embedding. */
function chunkRow(projectId: string, c: IndexChunk) {
  return {
    project_id: projectId,
    file_path: c.path,
    symbol_name: c.chunk.symbolName,
    signature: c.chunk.signature,
    line_start: c.chunk.lineStart,
    line_end: c.chunk.lineEnd,
    language: c.chunk.language,
    content_hash: c.hash,
    content_preview: c.chunk.body.slice(0, 600),
    imports: c.imports,
    last_modified: new Date().toISOString(),
    tombstoned_at: null,
  };
}

/**
 * Re-write the metadata of chunks whose text did not change (un-tombstone,
 * new imports, moved lines). The embedding column is not in the payload, so
 * the stored embedding is kept and nothing is paid for.
 */
async function refreshChunks(
  db: ReturnType<typeof getDb>,
  projectId: string,
  chunks: IndexChunk[],
): Promise<{ refreshed: number; failed: number; lastError?: string; paths: Set<string> }> {
  let refreshed = 0;
  let failed = 0;
  let lastError: string | undefined;
  const paths = new Set<string>();
  for (let i = 0; i < chunks.length; i += 200) {
    const batch = chunks.slice(i, i + 200);
    const { error } = await db
      .from('project_codebase_files')
      .upsert(batch.map((c) => chunkRow(projectId, c)), { onConflict: 'project_id,file_path,symbol_name' });
    if (error) {
      failed += batch.length;
      lastError = `chunk refresh failed: ${error.message}`;
      log.error('chunk refresh failed', { projectId, batchSize: batch.length, error: error.message });
    } else {
      refreshed += batch.length;
      for (const c of batch) paths.add(c.path);
    }
  }
  return { refreshed, failed, lastError, paths };
}

/** Ceiling for a targeted (frame-path) run: an import names ≤10 issues. */
const TARGETED_FILE_CAP = 25;
/** Statuses whose fix site no longer needs to be in the index first. */
const DONE_REPORT_STATUSES = ['fixed', 'resolved', 'verified', 'dismissed'];

function parseTargetFramePaths(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out = new Set<string>();
  for (const v of raw.slice(0, TARGETED_FILE_CAP)) {
    const p = typeof v === 'string' ? normalizeFramePath(v) : null;
    if (p) out.add(p);
  }
  return [...out];
}

/**
 * Stack-frame paths of this project's open Sentry-linked reports (newest 50).
 * Reads `custom_metadata.sentryFrames`, falling back to the stored stack text
 * for reports ingested before that field existed. Best-effort: a failed read
 * just means no frame priority this sweep.
 */
async function loadOpenSentryFramePaths(db: ReturnType<typeof getDb>, projectId: string): Promise<string[]> {
  const { data, error } = await db
    .from('reports')
    .select('custom_metadata, console_logs')
    .eq('project_id', projectId)
    .eq('custom_metadata->>source', 'sentry_webhook')
    .not('status', 'in', `(${DONE_REPORT_STATUSES.join(',')})`)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) {
    log.warn('sweep: sentry frame lookup failed', { projectId, error: error.message });
    return [];
  }
  const out = new Set<string>();
  for (const row of data ?? []) {
    const meta = (row.custom_metadata ?? {}) as { sentryFrames?: unknown };
    const stored = Array.isArray(meta.sentryFrames)
      ? meta.sentryFrames.filter((p): p is string => typeof p === 'string')
      : [];
    const fromStack = stored.length > 0
      ? []
      : ((row.console_logs ?? []) as Array<{ stack?: string }>).flatMap((l) => framePathsFromStackText(l?.stack));
    for (const p of [...stored, ...fromStack]) out.add(p);
  }
  return [...out].slice(0, 100);
}

/**
 * Paths already in the index (live rows), paged past PostgREST's 1000-row
 * cap. Rows are chunks, so the page loop runs over chunks; the 20k ceiling
 * matches MAX_INDEX_FILE_CAP's measurement limit. Null on a read error.
 */
async function loadIndexedPaths(db: ReturnType<typeof getDb>, projectId: string): Promise<Set<string> | null> {
  const out = new Set<string>();
  const page = 1000;
  for (let from = 0; from < 200_000; from += page) {
    const { data, error } = await db
      .from('project_codebase_files')
      .select('file_path')
      .eq('project_id', projectId)
      .is('tombstoned_at', null)
      .order('id', { ascending: true })
      .range(from, from + page - 1);
    if (error) {
      log.warn('sweep: indexed-path lookup failed', { projectId, error: error.message });
      return null;
    }
    for (const r of data ?? []) out.add(r.file_path as string);
    if (!data || data.length < page || out.size >= 20_000) break;
  }
  return out;
}

/**
 * The project's index coverage ceiling (gap #16b): by plan tier, or the
 * MUSHI_REPO_INDEX_SWEEP_FILE_CAP pin. A plan read error keeps the cap the
 * last sweep used (or the default) and says so, rather than guessing free.
 */
async function projectIndexFileCap(
  db: ReturnType<typeof getDb>,
  projectId: string,
  lastCap: number | null,
): Promise<IndexFileCap> {
  const envValue = Deno.env.get(INDEX_FILE_CAP_ENV);
  try {
    return indexFileCapForPlan(await resolveProjectPlan(db, projectId), envValue);
  } catch (err) {
    const fallback = indexFileCapForPlan(null, envValue);
    log.warn('sweep: plan lookup failed; using the last known index cap', {
      projectId,
      error: err instanceof Error ? err.message : String(err),
      lastCap,
    });
    return lastCap && fallback.source !== 'env' ? { cap: lastCap, source: 'default', planId: null } : fallback;
  }
}

async function sweepIndexRepo(
  db: ReturnType<typeof getDb>,
  projectId: string,
  token: string,
  owner: string,
  repo: string,
  branch: string,
  opts: { targetFramePaths?: string[]; fileCap?: IndexFileCap | null } = {},
): Promise<{
  /** Chunks embedded (new or changed text). */
  inserted: number;
  /** Chunks whose text was unchanged but whose row was refreshed, no embedding paid. */
  refreshed: number;
  /** Chunks left alone: same text, same imports, already embedded. */
  unchanged: number;
  skipped: number;
  failed: number;
  lastError?: string;
  /** Branch the sweep actually read. */
  branch: string;
  /** Head commit of that branch, when GitHub returned it. */
  headSha: string | null;
  /** Coverage after this sweep (null for a targeted frame-path run, which measures nothing). */
  coverage: IndexCoverage | null;
  /** Set when the configured branch 404'd and GitHub's default branch was used instead. */
  correctedBranch?: string;
}> {
  // A stale default_branch ('main' on a 'master' repo) used to throw
  // "tree fetch 404" on every sweep; the helper retries once with GitHub's
  // real default and reports it so the success update can persist it.
  const resolved = await fetchRepoTreeWithBranchFallback({ token, owner, repo, branch });
  if (resolved.correctedFrom) {
    log.warn('sweep: configured branch not found, indexed GitHub default branch instead', {
      repo: `${owner}/${repo}`,
      configured: resolved.correctedFrom,
      githubDefault: resolved.branch,
    });
  }
  branch = resolved.branch;
  const tree = resolved.tree;
  // Empty blobs and blobs over the fetch limit can never be stored; leaving
  // them out of the eligible set keeps coverage able to reach complete.
  const files = (tree.tree ?? []).filter((t) => t.type === 'blob' && shouldIndex(t.path) && isStorableBlob(t));
  let inserted = 0;
  let skipped = 0;
  let failed = 0;
  let lastError: string | undefined;
  // The plan's coverage ceiling (files the index may hold) and this run's
  // fetch budget are separate: a large ceiling fills over several hourly
  // runs instead of one run that outlives the edge function.
  const cap = opts.fileCap?.cap ?? indexFileCapForPlan(null, Deno.env.get(INDEX_FILE_CAP_ENV)).cap;
  const runBudget = envInt('MUSHI_REPO_INDEX_SWEEP_RUN_FILES', DEFAULT_SWEEP_RUN_FILES, { min: 1, max: 2000 });
  // Batched embedding sweep (MUSHI-MUSHI-INDEXER-429 fix):
  //
  // Why batching: the previous loop fired one embedding API call per chunk
  // (1077 chunks for the glot.it repo). That overshot OpenAI's TPM budget
  // because each request carries fixed per-call overhead (model name,
  // dimensions, headers) that gets counted toward token usage even when
  // the actual chunk is small. The result was a wave of:
  //   "Request too large for text-embedding-3-small … Limit 50000000,
  //    Requested 114"
  // — OpenAI's confusingly-worded "the next 114 tokens would push you
  // over your 50M-tokens-per-minute cap" error.
  //
  // OpenAI's embeddings endpoint accepts up to 2048 inputs per call and
  // returns embeddings in input order. Batching at 96 inputs cuts the
  // request count to ~11 for a 1077-chunk repo and keeps the token count
  // accurately scoped to the actual chunk text.
  //
  // Throttling between batches stays for two reasons: (1) safety margin
  // against shared-org TPM consumption from other workers, (2) an
  // additional layer of resilience on top of `createEmbeddingBatch`'s
  // built-in exponential backoff. The default 250ms gives ~4 batches/s
  // (~384 inputs/s) which is well inside the published limits.
  const batchSize = envInt('MUSHI_REPO_INDEX_BATCH_SIZE', 96, { min: 1, max: 2048 });
  const throttleMs = envInt('MUSHI_REPO_INDEX_SWEEP_THROTTLE_MS', 250, { min: 0 });

  // Phase 1: walk the file tree and collect every chunk. We materialise the
  // whole list before embedding so we can size batches deterministically.
  // Memory is bounded by `runBudget * avg-chunks-per-file * preview-size` —
  // at the default 300-file budget with ~5 chunks per file × 600-char
  // preview, that's ~900 KB worst case; comfortable inside the Edge Function
  // memory budget.
  // Which files: see _shared/sweep-file-priority.ts. Stack-frame files of
  // open Sentry-linked reports first, then application source, unindexed
  // before indexed. A targeted run embeds only the given frame files.
  const treePaths = files.map((f) => f.path);
  const targeted = (opts.targetFramePaths?.length ?? 0) > 0;
  let selected: string[];
  let indexedBefore = new Set<string>();
  if (targeted) {
    selected = matchFramePathsToTree(opts.targetFramePaths ?? [], treePaths).slice(0, TARGETED_FILE_CAP);
  } else {
    const [framePaths, indexedPaths] = await Promise.all([
      loadOpenSentryFramePaths(db, projectId),
      loadIndexedPaths(db, projectId),
    ]);
    // Without the current index we can neither respect the plan ceiling nor
    // measure coverage: fail this run (recorded in last_index_error) instead
    // of reporting a made-up number.
    if (!indexedPaths) throw new Error('indexed-path lookup failed; coverage unknown, sweep skipped');
    indexedBefore = indexedPaths;
    selected = selectSweepFiles({
      treePaths,
      framePaths: matchFramePathsToTree(framePaths, treePaths),
      indexedPaths,
      planCap: cap,
      runBudget,
    });
  }
  /** Paths with at least one chunk written (embedded or refreshed) this run. */
  const writtenPaths = new Set<string>();

  const pending: IndexChunk[] = [];
  /** Selected files that turned out gone, empty or too large: never indexable. */
  const unstorablePaths = new Set<string>();
  for (const path of selected) {
    const got = await fetchFileForIndex(token, owner, repo, path, branch);
    if (!('text' in got)) {
      skipped++;
      if (got.skip === 'unstorable') unstorablePaths.add(path);
      continue;
    }
    pending.push(...(await chunksForFile(path, got.text)));
  }

  // Hash before embedding: only new or changed text is embedded (Plan 020
  // §10.2 blocker 5 — every sweep used to pay for every chunk again).
  const stored = await loadStoredChunks(db, projectId, [...new Set(pending.map((p) => p.path))]);
  const plan = planChunkWrites(pending, stored);
  const refresh = await refreshChunks(db, projectId, plan.refresh);
  failed += refresh.failed;
  if (refresh.lastError) lastError = refresh.lastError;
  for (const p of refresh.paths) writtenPaths.add(p);

  // Phase 2: batched embedding + per-chunk upsert of the chunks that need
  // one. If a whole batch fails (e.g. retries exhausted) we count every
  // input in that batch as failed and continue with the next batch.
  for (let i = 0; i < plan.embed.length; i += batchSize) {
    const batch = plan.embed.slice(i, i + batchSize);
    let embeddings: number[][];
    try {
      embeddings = await createEmbeddingBatch(
        batch.map((b) => b.text),
        { projectId },
      );
    } catch (err) {
      failed += batch.length;
      lastError = err instanceof Error ? err.message : String(err);
      log.warn('sweep: batch embed failed (non-fatal)', {
        repo: `${owner}/${repo}`,
        batchSize: batch.length,
        firstPath: batch[0]?.path,
        error: lastError.slice(0, 240),
      });
      continue;
    }
    for (let j = 0; j < batch.length; j++) {
      const { error } = await db.from('project_codebase_files').upsert(
        {
          ...chunkRow(projectId, batch[j]),
          embedding: embeddings[j],
          embedding_model: 'text-embedding-3-small',
        },
        { onConflict: 'project_id,file_path,symbol_name' },
      );
      if (error) {
        skipped++;
        continue;
      }
      inserted++;
      writtenPaths.add(batch[j].path);
    }
    if (throttleMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, throttleMs));
    }
  }
  // Honesty over unconditional success: a capped or truncated sweep used to
  // report clean success, leaving big monorepos silently half-indexed. The
  // index after this run is what it held before plus what this run wrote
  // (a sweep never tombstones); only eligible tree files count.
  const coverage = targeted
    ? null
    : measureIndexCoverage({
      eligiblePaths: treePaths,
      indexedPaths: new Set([...indexedBefore, ...writtenPaths]),
      unstorablePaths,
      cap,
      truncated: tree.truncated === true,
    });
  const headSha = targeted ? null : await lookupBranchHeadSha(token, owner, repo, branch).catch(() => null);
  return {
    inserted,
    refreshed: refresh.refreshed,
    unchanged: plan.unchanged,
    skipped,
    failed,
    lastError,
    coverage,
    branch,
    headSha,
    ...(resolved.correctedFrom ? { correctedBranch: resolved.branch } : {}),
  };
}

/** Fields of a GitHub `push` payload the indexer reads. */
interface PushPayload {
  repository?: { full_name?: string; owner?: { login?: string }; name?: string; default_branch?: string };
  installation?: { id?: number };
  ref?: string;
  deleted?: boolean;
  after?: string;
  commits?: Array<{ id?: string; message?: string; timestamp?: string; added?: string[]; modified?: string[]; removed?: string[] }>;
  head_commit?: { id?: string; timestamp?: string };
}

/**
 * Index one push for one project: commit fix_events, then (default branch
 * only) tombstone removed paths and embed added/modified ones, update the
 * repo's indexed HEAD and enqueue an analyze job. Shared by the GitHub App
 * delivery (installation token) and the internal `mode: 'push'` call the
 * api forwards for PAT-connected repos (project token).
 */
async function indexPushForProject(
  db: ReturnType<typeof getDb>,
  args: {
    projectId: string;
    repoRowId: string;
    configuredDefaultBranch: string | null;
    token: string;
    owner: string;
    repo: string;
    payload: PushPayload;
    deliveryId: string;
  },
): Promise<{ status: 200 | 202 | 500; body: Record<string, unknown> }> {
  const { projectId, token, owner, repo, payload, deliveryId } = args;
  const repoFullName = `${owner}/${repo}`;
  const ref = payload.after ?? '';
  const { getProjectCodebaseScope } = await import('../_shared/codebase-understand.ts')
  const indexScope = await getProjectCodebaseScope(db, projectId)

  // Emit `commit` fix_events if this push is on a branch we're tracking
  // (i.e. fix_attempts.branch == ref). Runs before the embedding pipeline so
  // the timeline updates fast even if indexing is slow.
  try {
    await emitCommitEventsForPush(
      db,
      payload as Parameters<typeof emitCommitEventsForPush>[1],
      deliveryId,
    );
  } catch (err) {
    log.warn('emitCommitEventsForPush failed (non-fatal)', {
      err: err instanceof Error ? err.message : String(err),
    });
  }

  // One index per project, built from the default branch. A push to any
  // other branch used to overwrite default-branch code in the index.
  const branchDecision = pushBranchDecision(payload, args.configuredDefaultBranch);
  if (!branchDecision.index) {
    log.info('push not indexed', { projectId, repoFullName, branch: branchDecision.branch, reason: branchDecision.reason });
    return { status: 202, body: { ok: true, ignored: branchDecision.reason, branch: branchDecision.branch } };
  }

  const added = new Set<string>();
  const removed = new Set<string>();
  for (const commit of payload.commits ?? []) {
    for (const p of [...(commit.added ?? []), ...(commit.modified ?? [])]) added.add(p);
    for (const p of commit.removed ?? []) removed.add(p);
  }

  let inserted = 0;
  let tombstoned = 0;
  let upsertFailures = 0;
  let tombstoneFailures = 0;
  const languageCounts: Record<string, number> = {};

  for (const path of removed) {
    if (!shouldIndex(path, indexScope)) continue;
    const { error } = await db
      .from('project_codebase_files')
      .update({ tombstoned_at: new Date().toISOString() })
      .eq('project_id', projectId)
      .eq('file_path', path);
    if (error) {
      tombstoneFailures++;
      log.warn('tombstone failed', { projectId, path, error: error.message });
      continue;
    }
    tombstoned++;
  }

  // Same batching strategy as the sweep path (MUSHI-MUSHI-INDEXER-429): a
  // large `git rebase --force-push` can deliver dozens of files in one
  // webhook payload, and per-chunk embeddings will eat through the TPM
  // budget. Chunks are hashed first; only new or changed text is embedded,
  // in batches of 96.
  const pendingChunks: IndexChunk[] = [];
  for (const path of added) {
    if (!shouldIndex(path, indexScope)) continue;
    const source = await fetchFileContents(token, owner, repo, path, ref);
    if (!source) continue;
    pendingChunks.push(...(await chunksForFile(path, source)));
  }

  const storedChunks = await loadStoredChunks(db, projectId, [...new Set(pendingChunks.map((p) => p.path))]);
  const pushPlan = planChunkWrites(pendingChunks, storedChunks);
  const pushRefresh = await refreshChunks(db, projectId, pushPlan.refresh);
  upsertFailures += pushRefresh.failed;
  inserted += pushRefresh.refreshed;

  const pushBatchSize = envInt('MUSHI_REPO_INDEX_BATCH_SIZE', 96, { min: 1, max: 2048 });
  for (let i = 0; i < pushPlan.embed.length; i += pushBatchSize) {
    const batch = pushPlan.embed.slice(i, i + pushBatchSize);
    let embeddings: number[][];
    try {
      embeddings = await createEmbeddingBatch(
        batch.map((b) => b.text),
        { projectId },
      );
    } catch (err) {
      // Push embeddings are best-effort — log and move on. The next push
      // event for the same path will re-attempt indexing.
      log.warn('push: batch embed failed (non-fatal)', {
        projectId,
        repoFullName,
        batchSize: batch.length,
        firstPath: batch[0]?.path,
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }
    for (let j = 0; j < batch.length; j++) {
      const c = batch[j];
      // onConflict matches uq_codebase_chunks (project_id, file_path, symbol_name)
      // NULLS NOT DISTINCT — see migration 20260418000300_codebase_indexer.sql.
      const { error } = await db.from('project_codebase_files').upsert(
        {
          ...chunkRow(projectId, c),
          embedding: embeddings[j],
          embedding_model: 'text-embedding-3-small',
        },
        { onConflict: 'project_id,file_path,symbol_name' },
      );
      if (error) {
        upsertFailures++;
        log.error('chunk upsert failed', {
          projectId,
          path: c.path,
          symbolName: c.symbolName,
          error: error.message,
        });
        continue;
      }
      inserted++;
      languageCounts[c.chunk.language] = (languageCounts[c.chunk.language] ?? 0) + 1;
    }
  }

  log.info('indexed push', {
    projectId,
    repoFullName,
    ref,
    branch: branchDecision.branch,
    unchanged: pushPlan.unchanged,
    inserted,
    tombstoned,
    upsertFailures,
    tombstoneFailures,
  });

  // Keep this repo's indexed HEAD in sync for last-push diff impact, analyze
  // jobs and the radar. The column did not exist until 20261002140100 and the
  // write was never checked; a failure is now logged as an error.
  const { error: headErr } = await db
    .from('project_repos')
    .update({ commit_sha: ref, indexed_branch: branchDecision.branch, updated_at: new Date().toISOString() })
    .eq('id', args.repoRowId);
  if (headErr) log.error('push: project_repos head update failed', { projectId, error: headErr.message });

  try {
    const { invalidateCodebaseUnderstandCaches } = await import('../_shared/codebase-impact-resolve.ts')
    await invalidateCodebaseUnderstandCaches(db, projectId)
    const changedPaths = [...added]
    if (changedPaths.length > 0) {
      const { enqueueCodebaseAnalyzeJob } = await import('../_shared/codebase-analyze-runner.ts')
      const { jobId } = await enqueueCodebaseAnalyzeJob(db, {
        projectId,
        trigger: 'webhook_push',
        changedPaths,
      })
      const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
      const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
      if (supabaseUrl && serviceKey) {
        fetch(`${supabaseUrl}/functions/v1/codebase-analyze-worker`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${serviceKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ jobId }),
        }).catch((err) => log.warn('analyze worker invoke failed', { err: String(err) }))
      }
    }
  } catch (err) {
    log.warn('post-index analyze enqueue failed (non-fatal)', {
      err: err instanceof Error ? err.message : String(err),
    })
  }

  // If every attempted write failed, fail loudly so the webhook is retried —
  // a silent 200 here is what masked the original onConflict mismatch.
  const attempted = inserted + upsertFailures;
  if (attempted > 0 && inserted === 0) {
    return {
      status: 500,
      body: {
        ok: false,
        error: { code: 'ALL_UPSERTS_FAILED', message: 'Every chunk upsert failed; check logs.' },
        projectId,
        attempted,
      },
    };
  }

  return {
    status: 200,
    body: {
      ok: true,
      projectId,
      inserted,
      tombstoned,
      upsertFailures,
      tombstoneFailures,
      languages: languageCounts,
    },
  };}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function jsonResponse(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/**
 * Internal `mode: 'push'` (gap #16b): the api's `/v1/webhooks/github` route
 * has verified a push delivery against a PAT-connected project's own webhook
 * secret and forwards it here, because a repo without the GitHub App never
 * delivers to this function. Service-role auth only; the GitHub signature
 * was checked by the caller. Indexes with the project's token, through the
 * same indexPushForProject path as an App delivery.
 */
async function handleInternalPush(
  req: Request,
  body: { project_id?: unknown; repo_id?: unknown; delivery_id?: unknown; payload?: unknown },
): Promise<Response> {
  const unauthorized = requireServiceRoleAuth(req);
  if (unauthorized) return unauthorized;

  const projectId = typeof body.project_id === 'string' && UUID_RE.test(body.project_id) ? body.project_id : null;
  const repoId = typeof body.repo_id === 'string' && UUID_RE.test(body.repo_id) ? body.repo_id : null;
  const payload = body.payload && typeof body.payload === 'object' ? (body.payload as PushPayload) : null;
  const owner = payload?.repository?.owner?.login;
  const repo = payload?.repository?.name;
  if (!projectId || !repoId || !payload || !owner || !repo || !payload.after) {
    return jsonResponse({ ok: false, error: { code: 'BAD_REQUEST', message: 'project_id, repo_id and a push payload are required' } }, 400);
  }
  const deliveryId = typeof body.delivery_id === 'string' && body.delivery_id ? body.delivery_id : crypto.randomUUID();

  const db = getDb();
  const { data: row, error } = await db
    .from('project_repos')
    .select('id, project_id, repo_url, default_branch, github_app_installation_id, indexing_enabled')
    .eq('id', repoId)
    .eq('project_id', projectId)
    .maybeSingle();
  if (error) {
    log.error('internal push: project_repos read failed', { projectId, error: error.message });
    return jsonResponse({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500);
  }
  if (!row || !row.indexing_enabled) return jsonResponse({ ok: true, ignored: 'indexing_not_enabled' }, 202);
  // An App install already delivers this push here directly; indexing it twice
  // would double the embedding spend.
  if (row.github_app_installation_id) return jsonResponse({ ok: true, ignored: 'app_installation_delivers_directly' }, 202);
  if (String(row.repo_url).toLowerCase() !== `https://github.com/${owner}/${repo}`.toLowerCase()) {
    return jsonResponse({ ok: true, ignored: 'repo_mismatch' }, 202);
  }

  const token = await resolveProjectGithubToken(db, projectId);
  if (!token) {
    await db
      .from('project_repos')
      .update({ last_index_attempt_at: new Date().toISOString(), last_index_error: 'no_token: push received but no GitHub token resolved for this project' })
      .eq('id', repoId);
    return jsonResponse({ ok: true, ignored: 'no_token' }, 202);
  }

  const pushed = await indexPushForProject(db, {
    projectId,
    repoRowId: repoId,
    configuredDefaultBranch: (row.default_branch as string | null) ?? null,
    token,
    owner,
    repo,
    payload,
    deliveryId,
  });
  return jsonResponse({ ...pushed.body, via: 'pat_webhook' }, pushed.status);
}

app.post('/webhooks-github-indexer', async (c) => {
  const raw = await c.req.text();

  // Sweep mode: cron-invoked, no GitHub signature; auth via service-role bearer.
  // Internal caller (not inbound webhook traffic), so it deliberately bypasses
  // the audit/rate-limit/replay middleware below.
  if (raw.length > 0) {
    try {
      const peek = JSON.parse(raw) as { mode?: string; project_id?: string; repo_id?: unknown; delivery_id?: unknown; payload?: unknown };
      if (peek?.mode === 'sweep') {
        return await handleSweep(c.req.raw, peek);
      }
      if (peek?.mode === 'push') {
        return await handleInternalPush(c.req.raw, peek);
      }
    } catch {
      /* fall through to webhook handling */
    }
  }

  // Genuine inbound GitHub webhook delivery from here on — apply the same
  // audit-log + per-IP rate-limit + 24h replay-cache posture as the other
  // GitHub webhook route (api/routes/public.ts `/v1/webhooks/github`).
  const t0 = Date.now();
  const { audit, checkReplay, checkRateLimit } = createWebhookMiddleware('github');
  const auditDeliveryId = c.req.header('X-GitHub-Delivery') ?? null;
  const sourceIp =
    c.req.header('CF-Connecting-IP') ?? c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ?? null;

  const auditRow = await audit(c as never, raw, auditDeliveryId);
  try {
    checkRateLimit(sourceIp);
    await checkReplay(auditRow.id, auditDeliveryId);
  } catch (err) {
    if (err instanceof RateLimitError) {
      await auditRow.resolve('rejected_rate_limit', 429, Date.now() - t0, err.message);
      return c.json({ ok: false, error: err.message }, 429);
    }
    if (err instanceof ReplayAttackError) {
      await auditRow.resolve('rejected_replay', 409, Date.now() - t0, err.message);
      return c.json({ ok: false, error: 'Duplicate delivery' }, 409);
    }
    throw err;
  }

  if (!(await verifySignature(c.req.raw, raw))) {
    await auditRow.resolve('rejected_signature', 401, Date.now() - t0, 'Invalid signature');
    return c.json({ error: 'invalid signature' }, 401);
  }
  const event = c.req.header('X-GitHub-Event') ?? 'unknown';
  const deliveryId = auditDeliveryId ?? crypto.randomUUID();

  // Resolve the audit row now: it tracks the security gate (signature +
  // replay + rate limit), which has passed. Downstream business-logic
  // outcomes (per-event success/failure) are already tracked separately in
  // `fix_events` and `project_repos.last_index_error`, and this handler has
  // ~10 distinct event-type branches/early-returns below — threading a
  // second resolve() through each would duplicate that bookkeeping without
  // adding signal to the webhook_audit_log dashboard.
  await auditRow.resolve('accepted', 200, Date.now() - t0);

  // pull_request.*: covers opened / reopened / converted_to_draft /
  // ready_for_review / closed. Each updates `fix_attempts.pr_state`, emits a
  // `pr_state_changed` fix_event, and for merged PRs records the
  // `fixes_succeeded` usage_event via `handleFixPrMerged`.
  if (event === 'pull_request') {
    const prPayload = JSON.parse(raw) as {
      action?: string;
      pull_request?: {
        merged?: boolean;
        html_url?: string;
        number?: number;
        draft?: boolean;
        state?: string;
        head?: { ref?: string };
      };
      repository?: { full_name?: string };
    };
    const supportedActions = new Set([
      'opened',
      'reopened',
      'ready_for_review',
      'converted_to_draft',
      'closed',
    ]);
    if (!supportedActions.has(prPayload.action ?? '')) {
      return c.json({ ok: true, ignored: `pull_request.${prPayload.action ?? 'unknown'}` }, 202);
    }
    return await handlePullRequestState(prPayload, deliveryId);
  }

  // check_run.*: emits ci_started / ci_resolved fix_events and keeps the
  // fix_attempts.check_run_* columns fresh for the legacy synth path.
  if (event === 'check_run') {
    const crPayload = JSON.parse(raw) as {
      action?: string;
      check_run?: {
        id?: number;
        name?: string;
        status?: string;
        conclusion?: string | null;
        completed_at?: string | null;
        started_at?: string | null;
        html_url?: string | null;
        head_sha?: string | null;
        pull_requests?: Array<{ head?: { ref?: string } }>;
      };
      repository?: { full_name?: string };
    };
    return await handleCheckRun(crPayload, deliveryId);
  }

  if (event !== 'push' && event !== 'installation_repositories') {
    return c.json({ ok: true, ignored: event }, 202);
  }

  const payload = JSON.parse(raw) as PushPayload;

  const installationId = payload.installation?.id;
  const owner = payload.repository?.owner?.login;
  const repo = payload.repository?.name;
  const ref = payload.after;
  if (!installationId || !owner || !repo || !ref) {
    return c.json({ error: 'missing webhook fields' }, 400);
  }

  const db = getDb();
  const repoFullName = `${owner}/${repo}`;
  // Route to the project that bound this repository to this installation.
  // The old lookup matched project_integrations.config.repo, which any tenant
  // could set to someone else's "owner/repo" and receive its indexed source.
  const { data: project } = await db
    .from('project_repos')
    .select('id, project_id, default_branch')
    .eq('repo_url', `https://github.com/${repoFullName}`)
    .eq('github_app_installation_id', installationId)
    .eq('indexing_enabled', true)
    .limit(1)
    .maybeSingle();

  if (!project?.project_id) {
    return c.json({ ok: true, ignored: 'no_project_for_repo', repoFullName }, 202);
  }

  const projectId = project.project_id as string;
  // Lets the radar count accepted deliveries per project (webhook_never_delivered).
  await auditRow.setProject(projectId);
  const token = await mintInstallationToken(installationId);
  const pushed = await indexPushForProject(db, {
    projectId,
    repoRowId: project.id as string,
    configuredDefaultBranch: (project.default_branch as string | null) ?? null,
    token,
    owner,
    repo,
    payload,
    deliveryId,
  });
  return c.json(pushed.body, pushed.status);
});

Deno.serve(app.fetch);
