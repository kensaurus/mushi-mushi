// SPDX-License-Identifier: MIT
// Copyright (c) 2024–2026 Kenji Sakuramoto / Kensaurus 合同会社 — Mushi Mushi
/**
 * merge-queue — Supabase Edge Function (verify_jwt = false, internal)
 *
 * "Merge when ready" (ADR 0041). Every 5 minutes (pg_cron `mushi-merge-queue`)
 * and right after a person queues PRs in the console:
 *
 *   - one PR per repo at a time (the oldest queued one not blocked), so a repo
 *     has at most one queued PR in CI (the CI runner agreement), plus a cheap
 *     re-check of blocked rows, which never hold their repo;
 *   - reads the PR and the check runs on its head (`_shared/merge-queue.ts`):
 *     behind → GitHub "update branch"; CI running → wait; CI failed or branch
 *     protection → blocked (looked at again every tick: a CI-repair follow-up
 *     may fix it); draft → mark ready; clean → merge through the review gate
 *     (ADR 0030) as a service caller pinned to the head CI passed, then the
 *     same finalize as every merge (report Fixed, reporter told);
 *   - a conflict → a Cursor agent on the PR's branch merges the base and
 *     resolves it (at most 2 per PR, on the organization's review follow-up
 *     key and model, only while follow-ups are on); the row waits for its
 *     push, then carries on.
 *
 * Auth: `requireServiceRoleAuth`. `POST { projectId }` runs that app's rows now.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { getServiceClient } from '../_shared/db.ts'
import { withSentry } from '../_shared/sentry.ts'
import { requireServiceRoleAuth } from '../_shared/auth.ts'
import {
  fetchPullRequestDetails,
  installationIdForAttempt,
  markPullRequestReady,
  resolveProjectGithubToken,
  type GithubRepoRef,
} from '../_shared/github.ts'
import { gatedMergePullRequest } from '../_shared/gated-merge.ts'
import { finalizeFixMerge } from '../_shared/fix-merge.ts'
import { requeueReviewForNewHead } from '../_shared/fix-review-db.ts'
import { resolveCursorApiKeyWithSource } from '../_shared/agent-adapters.ts'
import { cursorKeyById, cursorModelsCached, loadFollowupSettings } from '../_shared/review-followup-db.ts'
import { validateCursorModel } from '../_shared/review-followup.ts'
import { createCursorAgentV1, getCursorAgent, getCursorRun } from '../_shared/cursor-cloud.ts'
import { checksView, type ChecksView } from '../_shared/merge-queue.ts'
import { runMergeQueue, type MergeQueueDeps } from './worker.ts'

const GH_HEADERS = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }

async function githubChecks(token: string, ref: GithubRepoRef, sha: string): Promise<ChecksView> {
  const res = await fetch(`https://api.github.com/repos/${ref.owner}/${ref.repo}/commits/${sha}/check-runs?per_page=100`, {
    headers: { ...GH_HEADERS, Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`GitHub check runs answered ${res.status}`)
  const body = (await res.json()) as { check_runs?: Array<{ name?: string; status?: string; conclusion?: string | null }> }
  return checksView(body.check_runs ?? [])
}

/** GitHub's "Update branch": merges the base into the PR branch (202), or 422 on a conflict. */
async function githubUpdateBranch(token: string, ref: GithubRepoRef, n: number, headSha: string) {
  const res = await fetch(`https://api.github.com/repos/${ref.owner}/${ref.repo}/pulls/${n}/update-branch`, {
    method: 'PUT',
    headers: { ...GH_HEADERS, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(headSha ? { expected_head_sha: headSha } : {}),
  })
  if (res.status === 202) return { ok: true, conflict: false }
  const body = (await res.json().catch(() => ({}))) as { message?: string }
  const message = body.message ?? `GitHub answered ${res.status}`
  return { ok: false, conflict: res.status === 422 && /conflict/i.test(message), message }
}

/**
 * The organization's review follow-up key and model (ADR 0032): an agent
 * pushes to a PR branch only while follow-ups are on, never on the platform
 * env key, and only with a model the key lists.
 */
async function followupCursorKey(db: SupabaseClient, projectId: string) {
  const { data: project } = await db.from('projects').select('organization_id').eq('id', projectId).maybeSingle()
  const org = (project as { organization_id?: string | null } | null)?.organization_id
  if (!org) return { ok: false as const, reason: 'This app has no organization.' }
  const settings = await loadFollowupSettings(db, org)
  if (!settings.enabled) {
    return { ok: false as const, reason: 'Review follow-ups are off, so no agent may push to the branch. Resolve it on GitHub, or turn them on in Settings → AI keys.' }
  }
  let apiKey: string
  let cacheKey: string
  if (settings.keyId) {
    const k = await cursorKeyById(db, settings.keyId, org, { projectId })
    if (!k.ok) return { ok: false as const, reason: `The follow-up Cursor key cannot be used here (${k.reason}).` }
    apiKey = k.apiKey
    cacheKey = k.cacheKey
  } else {
    const r = await resolveCursorApiKeyWithSource(db, projectId)
    if (!r || r.source === 'env') return { ok: false as const, reason: 'No Cursor key of yours serves this app.' }
    apiKey = r.key
    cacheKey = r.keyId ? `key:${r.keyId}` : `${r.source}:${projectId}`
  }
  let model: string | null = null
  if (settings.model) {
    const check = validateCursorModel(settings.model, await cursorModelsCached(cacheKey, apiKey, new Date()))
    if (!check.ok) return { ok: false as const, reason: `The follow-up model cannot run (${check.detail ?? check.reason}).` }
    model = check.model
  }
  return { ok: true as const, apiKey, model }
}

async function githubBehindBy(token: string, ref: GithubRepoRef, base: string, head: string): Promise<number> {
  const res = await fetch(`https://api.github.com/repos/${ref.owner}/${ref.repo}/compare/${encodeURIComponent(base)}...${head}`, {
    headers: { ...GH_HEADERS, Authorization: `Bearer ${token}` },
  })
  if (!res.ok) return 0
  const body = (await res.json()) as { behind_by?: number }
  return body.behind_by ?? 0
}

const liveDeps: MergeQueueDeps = {
  token: async (db, attempt) => resolveProjectGithubToken(db as never, attempt.project_id, await installationIdForAttempt(db as never, attempt as never)),
  pull: fetchPullRequestDetails,
  checks: githubChecks,
  updateBranch: githubUpdateBranch,
  behindBy: githubBehindBy,
  ready: markPullRequestReady,
  merge: gatedMergePullRequest,
  finalize: finalizeFixMerge,
  requeueReview: requeueReviewForNewHead,
  cursorKey: followupCursorKey,
  createAgent: async (apiKey, input) => ({ agentId: (await createCursorAgentV1({ apiKey }, input)).agent.id }),
  agentDone: async (apiKey, agentId) => {
    const agent = await getCursorAgent({ apiKey }, agentId)
    if (!agent.latestRunId) return { done: false, result: null }
    const run = await getCursorRun({ apiKey }, agentId, agent.latestRunId)
    return { done: ['FINISHED', 'ERROR', 'CANCELLED', 'EXPIRED'].includes(String(run.status)), result: run.result ?? null }
  },
}

export async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, error: { code: 'METHOD_NOT_ALLOWED' } }), { status: 405 })
  }
  const unauthorized = requireServiceRoleAuth(req)
  if (unauthorized) return unauthorized
  const body = (await req.json().catch(() => ({}))) as { projectId?: unknown }
  const tally = await runMergeQueue(getServiceClient(), liveDeps, typeof body.projectId === 'string' ? body.projectId : undefined)
  return new Response(JSON.stringify({ ok: true, data: tally }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

if (typeof Deno !== 'undefined') {
  Deno.serve(withSentry('merge-queue', handler))
}
