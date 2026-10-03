/**
 * FILE: packages/server/supabase/functions/_shared/recipe-change.ts
 * PURPOSE: Recipe edits as draft PRs (Plan 019 Phase 3, Plan 020 Phase 4).
 *
 *   planRecipeChange  read each target file at the head SHA, check the path
 *                     against the recipe's allowlist (isWritablePath: never
 *                     workflows, env files, lockfiles, generated exports or
 *                     migrations; store edits only inside store.listingDir),
 *                     and return a diff. No writes.
 *   runRecipeChange   one job per repo: dedupe against an open Mushi PR on the
 *                     same element, re-check every path, then createPrFromFiles
 *                     with markReady:false so the host's CI does not run until
 *                     the owner chooses. Listing PRs are published by the
 *                     host's own CI after merge (Plan 020 S-1).
 */

import type { getServiceClient } from './db.ts'
import type { createPrFromFiles, findOpenPrByHeadPrefix } from './github-pr.ts'
import { unifiedDiff } from './design-change.ts'
import { isWritablePath, type RecipeManifest } from './recipe-schema.ts'
import { normalizeRepoPath } from './recipe-glob.ts'
import type { readRepoFile, RecipeRepo, RecipeRepoResolution } from './recipe-github.ts'
import { scanForSecrets } from './secret-scan.ts'

type Db = ReturnType<typeof getServiceClient>

export const RECIPE_CHANGE_ELEMENTS = ['design', 'gates', 'env', 'routes', 'store', 'release'] as const
export type RecipeChangeElement = (typeof RECIPE_CHANGE_ELEMENTS)[number]
export const MAX_BATCH_REPOS = 10
const MAX_FILE_BYTES = 512 * 1024

export interface RecipeEdit {
  path: string
  content: string
  reason?: string
}

export interface ChangeDeps {
  resolveRepo: (db: Db, projectId: string) => Promise<RecipeRepoResolution>
  getDefaultHead: (repo: RecipeRepo) => Promise<{ branch: string; sha: string }>
  readRepoFile: typeof readRepoFile
  createPr: typeof createPrFromFiles
  findOpenPr: typeof findOpenPrByHeadPrefix
  now: () => Date
}

export interface PlannedChange {
  ok: boolean
  reason: string | null
  files: Array<{ path: string; diff: string; additions: number; deletions: number; reason: string; before: string; after: string }>
  denied: Array<{ path: string; reason: string }>
  repo: RecipeRepo | null
  head: { branch: string; sha: string } | null
}

export async function planRecipeChange(db: Db, projectId: string, element: RecipeChangeElement, edits: readonly RecipeEdit[], deps: ChangeDeps): Promise<PlannedChange> {
  const empty = (reason: string): PlannedChange => ({ ok: false, reason, files: [], denied: [], repo: null, head: null })
  const { data: snap } = await db.from('app_recipe_snapshots').select('manifest').eq('project_id', projectId).eq('is_current', true).maybeSingle()
  const manifest = ((snap as { manifest?: RecipeManifest | null } | null)?.manifest) ?? null
  if (!manifest) return empty('This repo has no valid mushi.recipe.json, so nothing is writable.')
  const repo = await deps.resolveRepo(db, projectId)
  if (!repo.ok) return empty(repo.reason)
  const head = await deps.getDefaultHead(repo.repo)
  const rawListingDir = (manifest as unknown as { store?: { listingDir?: unknown } }).store?.listingDir
  const listingDir = typeof rawListingDir === 'string' ? normalizeRepoPath(rawListingDir.replace(/\/+$/, '')) : null

  const files: PlannedChange['files'] = []
  const denied: PlannedChange['denied'] = []
  for (const e of edits) {
    const check = isWritablePath(e.path, manifest)
    if (!check.ok) { denied.push({ path: e.path, reason: check.reason }); continue }
    if ((element === 'store' || element === 'release') && (!listingDir || !check.path.startsWith(`${listingDir}/`))) {
      denied.push({ path: check.path, reason: listingDir ? `store edits stay inside ${listingDir}/` : 'mushi.recipe.json declares no store.listingDir' })
      continue
    }
    if (e.content.length > MAX_FILE_BYTES) { denied.push({ path: check.path, reason: 'over 512 KB' }); continue }
    const secret = scanForSecrets(e.content)
    if (secret) { denied.push({ path: check.path, reason: `contains something shaped like a ${secret}` }); continue }
    const current = await deps.readRepoFile(repo.repo, head.sha, check.path, MAX_FILE_BYTES)
    if (current.kind === 'too_large') { denied.push({ path: check.path, reason: 'the current file is over 512 KB' }); continue }
    const before = current.kind === 'file' ? current.text : ''
    const d = unifiedDiff(check.path, before, e.content)
    if (d.additions + d.deletions === 0) continue
    files.push({ path: check.path, diff: d.diff, additions: d.additions, deletions: d.deletions, reason: e.reason ?? `update ${check.path}`, before, after: e.content })
  }
  return { ok: true, reason: null, files, denied, repo: repo.repo, head }
}

export interface JobResult {
  jobId: string
  projectId: string
  status: 'pr_opened' | 'failed' | 'rejected'
  prUrl: string | null
  error: string | null
}

/** Run one job end to end. Never throws; the job row records what happened. */
export async function runRecipeChange(
  db: Db,
  input: { projectId: string; element: RecipeChangeElement; edits: readonly RecipeEdit[]; title: string; requestedBy: string; batchId?: string | null },
  deps: ChangeDeps,
): Promise<JobResult> {
  const { data: job, error: jobErr } = await db.from('recipe_change_jobs').insert({
    project_id: input.projectId, element: input.element, status: 'queued', requested_by: input.requestedBy, batch_id: input.batchId ?? null,
    plan: { element: input.element, paths: input.edits.map((e) => e.path) },
  }).select('id').single()
  if (jobErr || !job) {
    return { jobId: '', projectId: input.projectId, status: 'rejected', prUrl: null, error: jobErr?.code === '23505' ? 'A change for this part of the recipe is already running.' : 'The job could not be created.' }
  }
  const jobId = (job as { id: string }).id
  const done = async (status: JobResult['status'], patch: Record<string, unknown>, error: string | null, prUrl: string | null = null): Promise<JobResult> => {
    await db.from('recipe_change_jobs').update({ status, error, finished_at: deps.now().toISOString(), updated_at: deps.now().toISOString(), ...patch }).eq('id', jobId)
    return { jobId, projectId: input.projectId, status, prUrl, error }
  }
  await db.from('recipe_change_jobs').update({ status: 'running', started_at: deps.now().toISOString(), updated_at: deps.now().toISOString() }).eq('id', jobId)
  try {
    const plan = await planRecipeChange(db, input.projectId, input.element, input.edits, deps)
    if (!plan.ok || !plan.repo || !plan.head) return done('rejected', {}, plan.reason ?? 'Nothing is writable.')
    if (plan.denied.length) return done('rejected', { plan: { element: input.element, denied: plan.denied } }, `Not writable: ${plan.denied.map((d) => `${d.path} (${d.reason})`).join('; ')}`.slice(0, 500))
    if (plan.files.length === 0) return done('rejected', {}, 'Nothing would change.')
    const prefix = `mushi/recipe-${input.element}`
    const open = await deps.findOpenPr(plan.repo.token, plan.repo.ref.owner, plan.repo.ref.repo, prefix)
    if (open) return done('rejected', { pr_url: open.url, pr_number: open.number }, `A Mushi draft PR for this is already open: ${open.url}`, open.url)
    const pr = await deps.createPr({
      token: plan.repo.token,
      owner: plan.repo.ref.owner,
      repo: plan.repo.ref.repo,
      defaultBranch: plan.head.branch,
      branch: `${prefix}-${deps.now().getTime().toString(36)}`,
      title: input.title,
      body: [
        'Proposed by Mushi from the app recipe (Plan 019).',
        '',
        ...plan.files.map((f) => `- \`${f.path}\`: ${f.reason}`),
        '',
        input.element === 'store' || input.element === 'release'
          ? 'After you merge, your own CI publishes the listing with your own key. Mushi never publishes to a store.'
          : 'Nothing runs until you merge.',
        'This PR stays a **draft** so your CI does not run until you mark it ready for review.',
        `Job ${jobId}, requested by ${input.requestedBy}.`,
      ].join('\n'),
      files: plan.files.map((f) => ({ path: f.path, contents: f.after, reason: f.reason })),
      category: 'chore',
      markReady: false,
    })
    return done('pr_opened', { pr_url: pr.url, pr_number: pr.number, branch: pr.branch, commit_sha: pr.commitSha }, null, pr.url)
  } catch (err) {
    return done('failed', {}, ((err as Error)?.message ?? String(err)).slice(0, 500))
  }
}
