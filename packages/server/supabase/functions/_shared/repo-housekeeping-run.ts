/**
 * FILE: packages/server/supabase/functions/_shared/repo-housekeeping-run.ts
 * PURPOSE: Run one approved repo clean-up action (ADR 0051). Called only by
 *          executeConnectorAction with `deps.housekeepingAct` (api-ext), after
 *          the connector-action claim: the approval was a console owner or
 *          admin, within the hour, on exactly this payload's hash.
 *
 * Before anything changes on GitHub:
 *   - the payload passes housekeepingPayloadProblem;
 *   - the app ran fewer than 5 clean-ups in the last hour (restores excepted);
 *   - the item log table exists (Restore depends on it) and the repo is still
 *     bound to the app; a token can reach it.
 *
 * Each item is checked again, on fresh reads, and refused when:
 *   delete_branches  the default branch, a protected branch, the head or base
 *                    of an open PR, a running Mushi row on it, or a tip that
 *                    is not the commit the approval recorded. The item row
 *                    (with that commit) is written BEFORE the delete; if it
 *                    cannot be written, nothing is deleted. The delete itself
 *                    asks GitHub to delete only if the branch still points at
 *                    that commit (updateRefs beforeOid); where GitHub does not
 *                    offer that, Mushi re-reads the branch just before a REST
 *                    DELETE, and the item records method 'reread' (the race
 *                    the console states).
 *   close_prs        not open, merged, the head moved, the fix is not this
 *                    app's or its PR number changed, a running Mushi row, or
 *                    riding a release train. Closed through fix-close.ts, so
 *                    the reason becomes a team note on the report.
 *   restore_branches the item is not a branch Mushi deleted for this app, was
 *                    restored already, or a branch with that name exists.
 *   setting          already on (skipped), or the token cannot change it.
 *
 * Mutations are spaced (GitHub asks for serial writes about a second apart);
 * the run stops with "not run" items at its deadline or when the GitHub API
 * quota falls under a floor. One audit entry per item.
 */

import type { getServiceClient } from './db.ts'
import type { ApprovedConnectorAction, ConnectorActionResult } from './connectors/types.ts'
import { HOUSEKEEPING_ACTIONS, type HousekeepingAction } from './repo-housekeeping-acts.ts'
import {
  branchRefusal,
  HOUSEKEEPING_ACTIONS_PER_HOUR,
  housekeepingPayloadProblem,
  type ClosePrsPayload,
  type DeleteBranchesPayload,
  type RestorePayload,
} from './repo-housekeeping.ts'
import { boundRepos, isMissingTable, loadRecorded, loadRiding } from './repo-housekeeping-load.ts'
import {
  createRef,
  deleteRefIfAt,
  deleteRefRest,
  enableDeleteBranchOnMerge,
  ghClient,
  listPulls,
  readBranch,
  readPull,
  readRefSha,
  readRepo,
  type FetchLike,
  type Gh,
} from './repo-housekeeping-github.ts'
import { closeFixPullRequest } from './fix-close.ts'

type Db = ReturnType<typeof getServiceClient>

/** GitHub API calls left below which the run stops (other Mushi work shares the quota). */
export const GITHUB_FLOOR = 300
/** Wall time for one run; items not reached are reported "not run". */
export const RUN_DEADLINE_MS = 110_000
/** Gap between two GitHub writes. */
export const WRITE_SPACING_MS = 1_000

export interface HousekeepingRunDeps {
  fetch: FetchLike
  now: () => Date
  sleep: (ms: number) => Promise<void>
  /** Token for branches and PRs (see the routes' resolver). */
  token: (db: Db, projectId: string, repo: { repo: string; installationId: number | null }) => Promise<string | null>
  /** Token for repo settings: the project's stored token only (the App has no Administration permission). */
  settingsToken: (db: Db, projectId: string) => Promise<string | null>
  /** Close a PR on GitHub (fix-close's closePullRequest with this token). */
  closePull: (token: string, repo: string, n: number) => Promise<boolean>
  deadlineMs?: number
  spacingMs?: number
}

interface ItemOutcome {
  key: string
  outcome: 'done' | 'refused' | 'skipped' | 'failed' | 'not_run'
  detail: string
  branch?: string
  prNumber?: number
  sha?: string | null
  method?: 'cas' | 'reread'
}

interface RunCtx {
  db: Db
  organizationId: string
  projectId: string
  action: ApprovedConnectorAction & { action: HousekeepingAction }
  deps: HousekeepingRunDeps
  started: number
}

const refuse = (detail: string, code: string, status: 403 | 409 = 409): ConnectorActionResult => ({ ok: false, detail, code, status })

async function writeItem(ctx: RunCtx, repo: string, row: Record<string, unknown>): Promise<string | null> {
  const { data, error } = await ctx.db
    .from('repo_housekeeping_items')
    .insert({ action_id: ctx.action.id, organization_id: ctx.organizationId, project_id: ctx.projectId, repo, action: ctx.action.action, outcome: 'pending', ...row })
    .select('id')
    .single()
  return error || !data ? null : (data as { id: string }).id
}

async function updateItem(ctx: RunCtx, id: string, patch: Record<string, unknown>): Promise<void> {
  await ctx.db.from('repo_housekeeping_items').update({ ...patch, updated_at: ctx.deps.now().toISOString() }).eq('id', id)
}

async function auditItem(ctx: RunCtx, repo: string, o: ItemOutcome): Promise<void> {
  await ctx.db.from('org_audit_events').insert({
    organization_id: ctx.organizationId,
    project_id: ctx.projectId,
    actor_id: null,
    action: `repo_cleanup.${ctx.action.action}.${o.outcome}`,
    resource_type: 'connector_action',
    resource_id: ctx.action.id,
    metadata: { repo, key: o.key, branch: o.branch ?? null, pr_number: o.prNumber ?? null, sha: o.sha ?? null, method: o.method ?? null, detail: o.detail.slice(0, 300) },
  }).then(() => {}, () => {})
}

function outOfTime(ctx: RunCtx, gh: Gh | null): string | null {
  if (ctx.deps.now().getTime() - ctx.started > (ctx.deps.deadlineMs ?? RUN_DEADLINE_MS)) return 'Not run: the clean-up ran out of time. Ask again for what is left.'
  if (gh && gh.remaining < GITHUB_FLOOR) return `Not run: fewer than ${GITHUB_FLOOR} GitHub API calls are left this hour. Ask again later.`
  return null
}

/** How many clean-ups (restores excepted) ran for this app in the last hour, besides this one. */
async function runsLastHour(db: Db, projectId: string, selfId: string, now: Date): Promise<number | null> {
  const { data, error } = await db
    .from('connector_actions')
    .select('id, action, executed_at')
    .eq('project_id', projectId)
    .in('action', HOUSEKEEPING_ACTIONS.filter((a) => a !== 'restore_branches'))
    .gt('executed_at', new Date(now.getTime() - 3600_000).toISOString())
  if (error) return null
  return ((data ?? []) as Array<{ id: string }>).filter((r) => r.id !== selfId).length
}

function summarize(verb: string, outcomes: ItemOutcome[]): string {
  const n = (o: ItemOutcome['outcome']) => outcomes.filter((x) => x.outcome === o).length
  const parts = [`${verb} ${n('done')} of ${outcomes.length}`]
  if (n('refused')) parts.push(`${n('refused')} refused`)
  if (n('skipped')) parts.push(`${n('skipped')} skipped`)
  if (n('failed')) parts.push(`${n('failed')} failed`)
  if (n('not_run')) parts.push(`${n('not_run')} not run`)
  return `${parts.join(', ')}.`
}

export async function runHousekeepingAction(
  input: { db: Db; organizationId: string; projectId: string; action: ApprovedConnectorAction },
  deps: HousekeepingRunDeps,
): Promise<ConnectorActionResult> {
  const name = input.action.action
  if (!(HOUSEKEEPING_ACTIONS as readonly string[]).includes(name)) return refuse(`"${name}" is not a repo clean-up action.`, 'ACTION_NOT_SUPPORTED', 403)
  const problem = housekeepingPayloadProblem(name, input.action.payload)
  if (problem) return refuse(problem, 'PAYLOAD_INVALID', 403)
  const ctx: RunCtx = { db: input.db, organizationId: input.organizationId, projectId: input.projectId, action: input.action as RunCtx['action'], deps, started: deps.now().getTime() }
  const repo = String(input.action.payload.repo).toLowerCase()

  if (name !== 'restore_branches') {
    const ran = await runsLastHour(ctx.db, ctx.projectId, ctx.action.id, deps.now())
    if (ran === null) return refuse('Mushi could not count this app\'s clean-ups in the last hour, so nothing ran. Try again in a minute.', 'DB_ERROR')
    if (ran >= HOUSEKEEPING_ACTIONS_PER_HOUR) return refuse(`At most ${HOUSEKEEPING_ACTIONS_PER_HOUR} clean-ups run an hour per app. Approve it again after the hour.`, 'RATE_LIMITED')
  }
  const probe = await ctx.db.from('repo_housekeeping_items').select('id').limit(1)
  if (probe.error) {
    return isMissingTable(probe.error)
      ? refuse('Repo clean-up needs the database update 20261027183000_repo_housekeeping_items first. Nothing ran.', 'MIGRATION_PENDING')
      : refuse('Mushi could not read its clean-up log, so nothing ran.', 'DB_ERROR')
  }
  let bound: Array<{ repo: string; installationId: number | null }>
  try {
    bound = await boundRepos(ctx.db, ctx.projectId)
  } catch {
    return refuse('Mushi could not read this app\'s repositories, so nothing ran.', 'DB_ERROR')
  }
  const target = bound.find((b) => b.repo === repo)
  if (!target) return refuse(`${repo} is no longer connected to this app. Nothing ran.`, 'REPO_NOT_IN_PROJECT', 403)

  if (name === 'set_delete_branch_on_merge') return runSetting(ctx, repo)
  const token = await deps.token(ctx.db, ctx.projectId, target)
  if (!token) return refuse('No GitHub token can reach this repository. Nothing ran.', 'NO_GITHUB_TOKEN')
  const gh = ghClient(deps.fetch, token)
  if (name === 'delete_branches') return runDeletes(ctx, gh, repo, input.action.payload as unknown as DeleteBranchesPayload)
  if (name === 'close_prs') return runCloses(ctx, gh, token, repo, input.action.payload as unknown as ClosePrsPayload)
  return runRestores(ctx, gh, repo, input.action.payload as unknown as RestorePayload)
}

// ─────────────────────────────────────────────────────────────────────────────

async function runDeletes(ctx: RunCtx, gh: Gh, repo: string, p: DeleteBranchesPayload): Promise<ConnectorActionResult> {
  const info = await readRepo(gh, repo)
  if (!info.info) return refuse(`GitHub answered ${info.status || 'nothing'} when Mushi read ${repo}. Nothing was deleted.`, 'GITHUB_UNREADABLE')
  if (!info.info.canPush) return refuse('The GitHub token Mushi uses for this repository cannot delete branches (it needs Contents: write). Nothing was deleted.', 'TOKEN_CANNOT_WRITE', 403)
  const open = await listPulls(gh, repo, 'open', 10)
  if (!open.ok || open.truncated) return refuse('GitHub did not list every open pull request, so Mushi cannot rule them out. Nothing was deleted.', 'GITHUB_UNREADABLE')
  let active: Set<string>
  try {
    active = (await loadRecorded(ctx.db, ctx.projectId)).activeBranches
  } catch {
    return refuse('Mushi could not read its own runs on these branches, so nothing was deleted.', 'DB_ERROR')
  }
  const outcomes: ItemOutcome[] = []
  let wrote = false
  for (const item of p.items) {
    const base = { key: item.key, branch: item.branch }
    const stop = outOfTime(ctx, gh)
    if (stop) {
      outcomes.push({ ...base, outcome: 'not_run', detail: stop })
      continue
    }
    const finish = async (o: ItemOutcome, rowId: string | null) => {
      outcomes.push(o)
      if (rowId) await updateItem(ctx, rowId, { outcome: o.outcome === 'not_run' ? 'skipped' : o.outcome, detail: o.detail.slice(0, 500), method: o.method ?? null, ...(o.outcome === 'done' ? {} : { deleted_sha: null }) })
      await auditItem(ctx, repo, o)
    }
    const rowId = await writeItem(ctx, repo, { item_key: item.key, branch: item.branch, pr_number: item.prNumber, expected_sha: item.headSha })
    if (!rowId) {
      await finish({ ...base, outcome: 'failed', detail: 'Mushi could not record this branch before deleting it, so it was not deleted.' }, null)
      continue
    }
    const now = await readBranch(gh, repo, item.branch)
    if (now.status === 404) {
      await finish({ ...base, outcome: 'skipped', detail: 'Already gone from GitHub.' }, rowId)
      continue
    }
    if (!now.branch) {
      await finish({ ...base, outcome: 'failed', detail: `GitHub answered ${now.status || 'nothing'} when Mushi read the branch; not deleted.` }, rowId)
      continue
    }
    const refused = branchRefusal({ repo, branch: item.branch, defaultBranch: info.info.defaultBranch, protectedBranch: now.branch.protected, openPulls: open.pulls })
      ?? (active.has(item.branch) ? 'A Mushi run on this branch is still going.' : null)
      ?? (now.branch.sha !== item.headSha ? `It moved to ${now.branch.sha.slice(0, 7)} after the list was approved (approved at ${item.headSha.slice(0, 7)}).` : null)
    if (refused) {
      await finish({ ...base, outcome: 'refused', detail: refused, sha: now.branch.sha }, rowId)
      continue
    }
    // The commit Restore recreates is on the row before the branch is gone.
    await updateItem(ctx, rowId, { deleted_sha: item.headSha })
    if (wrote) await ctx.deps.sleep(ctx.deps.spacingMs ?? WRITE_SPACING_MS)
    wrote = true
    let method: 'cas' | 'reread' = 'cas'
    const cas = info.info.nodeId ? await deleteRefIfAt(gh, info.info.nodeId, item.branch, item.headSha) : { kind: 'unavailable' as const, message: 'no repository id' }
    if (cas.kind === 'deleted') {
      await finish({ ...base, outcome: 'done', detail: 'Deleted; GitHub checked it still pointed at the approved commit.', sha: item.headSha, method }, rowId)
      continue
    }
    if (cas.kind === 'refused') {
      const after = await readRefSha(gh, repo, item.branch)
      const detail = after.sha && after.sha !== item.headSha ? `It moved to ${after.sha.slice(0, 7)} just before the delete; not deleted.` : `GitHub refused the delete: ${cas.message}`
      await finish({ ...base, outcome: 'refused', detail, sha: after.sha }, rowId)
      continue
    }
    // No checked delete for this token: read the branch again, then delete.
    method = 'reread'
    const reread = await readRefSha(gh, repo, item.branch)
    if (reread.sha !== item.headSha) {
      await finish({ ...base, outcome: reread.status === 404 ? 'skipped' : 'refused', detail: reread.status === 404 ? 'Already gone from GitHub.' : 'It moved just before the delete; not deleted.', sha: reread.sha, method }, rowId)
      continue
    }
    const status = await deleteRefRest(gh, repo, item.branch)
    if (status === 204) await finish({ ...base, outcome: 'done', detail: 'Deleted after reading it again just before (a push in that second would be lost; Restore brings back the approved commit).', sha: item.headSha, method }, rowId)
    else if (status === 422) await finish({ ...base, outcome: 'refused', detail: 'GitHub refused: a rule protects this branch.', method }, rowId)
    else if (status === 404) await finish({ ...base, outcome: 'skipped', detail: 'Already gone from GitHub.', method }, rowId)
    else await finish({ ...base, outcome: 'failed', detail: `GitHub answered ${status || 'nothing'} to the delete.`, method }, rowId)
  }
  return { ok: true, detail: summarize('Deleted', outcomes), result: { repo, items: outcomes } }
}

async function runCloses(ctx: RunCtx, gh: Gh, token: string, repo: string, p: ClosePrsPayload): Promise<ConnectorActionResult> {
  let recorded: Awaited<ReturnType<typeof loadRecorded>>
  let riding: Set<number>
  try {
    recorded = await loadRecorded(ctx.db, ctx.projectId)
    riding = (await loadRiding(ctx.db, ctx.projectId)).get(repo) ?? new Set()
  } catch {
    return refuse('Mushi could not read its fixes for this app, so nothing was closed.', 'DB_ERROR')
  }
  const ids = p.items.map((i) => i.fixAttemptId)
  const { data: fixRows, error } = await ctx.db
    .from('fix_attempts')
    .select('id, project_id, report_id, agent, branch, commit_sha, pr_url, pr_number, merged_at, status')
    .in('id', ids)
  if (error) return refuse('Mushi could not read the fixes, so nothing was closed.', 'DB_ERROR')
  type FixRow = { id: string; project_id: string; report_id: string | null; agent: string | null; branch: string | null; commit_sha: string | null; pr_url: string | null; pr_number: number | null; merged_at: string | null }
  const fixes = new Map(((fixRows ?? []) as FixRow[]).map((f) => [f.id, f]))
  const outcomes: ItemOutcome[] = []
  let wrote = false
  for (const item of p.items) {
    const base = { key: item.key, prNumber: item.prNumber, branch: item.branch }
    const stop = outOfTime(ctx, gh)
    if (stop) {
      outcomes.push({ ...base, outcome: 'not_run', detail: stop })
      continue
    }
    const rowId = await writeItem(ctx, repo, { item_key: item.key, pr_number: item.prNumber, branch: item.branch, fix_attempt_id: item.fixAttemptId, expected_sha: item.headSha })
    const finish = async (o: ItemOutcome) => {
      outcomes.push(o)
      if (rowId) await updateItem(ctx, rowId, { outcome: o.outcome === 'not_run' ? 'skipped' : o.outcome, detail: o.detail.slice(0, 500) })
      await auditItem(ctx, repo, o)
    }
    const fix = fixes.get(item.fixAttemptId)
    const attempt = recorded.attempts.find((a) => a.id === item.fixAttemptId)
    if (!fix || fix.project_id !== ctx.projectId || fix.pr_number !== item.prNumber || !attempt || attempt.repo !== repo) {
      await finish({ ...base, outcome: 'refused', detail: 'This pull request is no longer recorded as this app\'s fix.' })
      continue
    }
    if (fix.merged_at) {
      await finish({ ...base, outcome: 'skipped', detail: 'Already merged.' })
      continue
    }
    if (attempt.active || recorded.activeBranches.has(item.branch)) {
      await finish({ ...base, outcome: 'refused', detail: 'A Mushi run on this pull request is still going.' })
      continue
    }
    if (riding.has(item.prNumber)) {
      await finish({ ...base, outcome: 'refused', detail: 'It is riding a release train.' })
      continue
    }
    const pull = await readPull(gh, repo, item.prNumber)
    if (!pull.pull) {
      await finish({ ...base, outcome: 'failed', detail: `GitHub answered ${pull.status || 'nothing'} when Mushi read the pull request.` })
      continue
    }
    if (pull.pull.merged) {
      await finish({ ...base, outcome: 'skipped', detail: 'Already merged on GitHub.' })
      continue
    }
    if (pull.pull.state !== 'open') {
      await finish({ ...base, outcome: 'skipped', detail: 'Already closed on GitHub.' })
      continue
    }
    if (pull.pull.headSha !== item.headSha) {
      await finish({ ...base, outcome: 'refused', detail: `New commits arrived after the list was approved (now ${pull.pull.headSha.slice(0, 7)}); not closed.`, sha: pull.pull.headSha })
      continue
    }
    if (wrote) await ctx.deps.sleep(ctx.deps.spacingMs ?? WRITE_SPACING_MS)
    wrote = true
    const reason = `${item.reason} (Repo clean-up)`.slice(0, 1000)
    const closed = await closeFixPullRequest(
      ctx.db,
      { fix, prNumber: item.prNumber, reason, author: 'Mushi repo clean-up', now: ctx.deps.now(), source: 'console' },
      () => ctx.deps.closePull(token, repo, item.prNumber),
    )
    await finish({ ...base, outcome: closed.ok ? 'done' : 'failed', detail: closed.message, sha: item.headSha })
  }
  return { ok: true, detail: summarize('Closed', outcomes), result: { repo, items: outcomes } }
}

async function runRestores(ctx: RunCtx, gh: Gh, repo: string, p: RestorePayload): Promise<ConnectorActionResult> {
  const { data, error } = await ctx.db
    .from('repo_housekeeping_items')
    .select('id, project_id, repo, action, branch, deleted_sha, outcome, restored_at')
    .in('id', p.items.map((i) => i.itemId))
  if (error) return refuse('Mushi could not read its clean-up log, so nothing was restored.', 'DB_ERROR')
  type Row = { id: string; project_id: string; repo: string; action: string; branch: string | null; deleted_sha: string | null; outcome: string; restored_at: string | null }
  const rows = new Map(((data ?? []) as Row[]).map((r) => [r.id, r]))
  const outcomes: ItemOutcome[] = []
  let wrote = false
  for (const item of p.items) {
    const base = { key: item.key, branch: item.branch }
    const stop = outOfTime(ctx, gh)
    if (stop) {
      outcomes.push({ ...base, outcome: 'not_run', detail: stop })
      continue
    }
    const rowId = await writeItem(ctx, repo, { item_key: item.key, branch: item.branch, expected_sha: item.sha })
    const finish = async (o: ItemOutcome) => {
      outcomes.push(o)
      if (rowId) await updateItem(ctx, rowId, { outcome: o.outcome === 'not_run' ? 'skipped' : o.outcome, detail: o.detail.slice(0, 500) })
      await auditItem(ctx, repo, o)
    }
    const src = rows.get(item.itemId)
    if (!src || src.project_id !== ctx.projectId || src.repo !== repo || src.action !== 'delete_branches' || src.branch !== item.branch || src.deleted_sha !== item.sha) {
      await finish({ ...base, outcome: 'refused', detail: 'This is not a branch Mushi deleted for this app.' })
      continue
    }
    if (src.restored_at) {
      await finish({ ...base, outcome: 'skipped', detail: 'Already restored.' })
      continue
    }
    const now = await readRefSha(gh, repo, item.branch)
    if (now.sha) {
      if (now.sha === item.sha) {
        await updateItem(ctx, src.id, { restored_by_action_id: ctx.action.id, restored_at: ctx.deps.now().toISOString() })
        await finish({ ...base, outcome: 'skipped', detail: 'The branch is already there at that commit.', sha: now.sha })
      } else {
        await finish({ ...base, outcome: 'refused', detail: `A branch with this name exists now (at ${now.sha.slice(0, 7)}); Mushi does not overwrite it.`, sha: now.sha })
      }
      continue
    }
    if (now.status !== 404) {
      await finish({ ...base, outcome: 'failed', detail: `GitHub answered ${now.status || 'nothing'} when Mushi read the branch.` })
      continue
    }
    if (wrote) await ctx.deps.sleep(ctx.deps.spacingMs ?? WRITE_SPACING_MS)
    wrote = true
    const status = await createRef(gh, repo, item.branch, item.sha)
    if (status === 201) {
      await updateItem(ctx, src.id, { restored_by_action_id: ctx.action.id, restored_at: ctx.deps.now().toISOString() })
      await finish({ ...base, outcome: 'done', detail: `Recreated at ${item.sha.slice(0, 7)}.`, sha: item.sha })
    } else {
      await finish({ ...base, outcome: 'failed', detail: status === 422 ? 'GitHub refused: the commit is gone or the name is taken.' : `GitHub answered ${status || 'nothing'}.` })
    }
  }
  return { ok: true, detail: summarize('Restored', outcomes), result: { repo, items: outcomes } }
}

async function runSetting(ctx: RunCtx, repo: string): Promise<ConnectorActionResult> {
  const key = 'setting:delete_branch_on_merge'
  const token = await ctx.deps.settingsToken(ctx.db, ctx.projectId)
  if (!token) return refuse('Turning this on needs a GitHub token stored for this app with "Administration: Read and write" on the repository. The Mushi GitHub App cannot change repository settings.', 'NO_GITHUB_TOKEN')
  const gh = ghClient(ctx.deps.fetch, token)
  const rowId = await writeItem(ctx, repo, { item_key: key })
  const finish = async (o: ItemOutcome, ok = true): Promise<ConnectorActionResult> => {
    if (rowId) await updateItem(ctx, rowId, { outcome: o.outcome === 'not_run' ? 'skipped' : o.outcome, detail: o.detail.slice(0, 500) })
    await auditItem(ctx, repo, o)
    return ok ? { ok: true, detail: o.detail, result: { repo, items: [o] } } : { ok: false, detail: o.detail, code: 'SETTING_REFUSED', status: 409, result: { repo, items: [o] } }
  }
  const info = await readRepo(gh, repo)
  if (!info.info) return finish({ key, outcome: 'failed', detail: `GitHub answered ${info.status || 'nothing'} when Mushi read the repository.` }, false)
  if (info.info.deleteBranchOnMerge) return finish({ key, outcome: 'skipped', detail: '"Automatically delete head branches" was already on.' })
  if (!info.info.canAdmin) return finish({ key, outcome: 'refused', detail: 'The stored token cannot change repository settings. Store a fine-grained token with "Administration: Read and write" on this repository.' }, false)
  const r = await enableDeleteBranchOnMerge(gh, repo)
  if (r.value === true) return finish({ key, outcome: 'done', detail: 'Turned on "Automatically delete head branches": GitHub deletes a pull request\'s branch when it merges.' })
  return finish({ key, outcome: 'failed', detail: `GitHub answered ${r.status || 'nothing'} and the setting is not on.` }, false)
}
