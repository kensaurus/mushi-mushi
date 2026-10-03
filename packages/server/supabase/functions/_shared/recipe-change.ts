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
 *                     It is createRecipeChangeJob + executeRecipeChangeJob;
 *                     the console runs the second half in the background and
 *                     follows the job row (streamRecipeChangeJob).
 *   readRecipeSources the fixed files an element's console form edits, read
 *                     at the head SHA (never a caller-chosen path).
 *
 * The new content of a file Mushi itself parses is validated before it can
 * reach a PR: mushi.recipe.json must still parse as a recipe (64 KB cap,
 * schema, secrets) and an inventory file must still pass inventory ingest.
 * Otherwise a merged edit would blank the recipe or break ingest.
 *
 * An edit may carry `baseSha`, the blob SHA the caller previewed against
 * (null = "the file did not exist"). A file that moved since is refused, so a
 * whole-file edit can never silently revert someone else's change.
 */

import type { getServiceClient } from './db.ts'
import type { createPrFromFiles, findOpenPrByHeadPrefix } from './github-pr.ts'
import { unifiedDiff } from './design-change.ts'
import { parseInventoryYaml } from './inventory.ts'
import { inventoryPathOf, isWritablePath, parseRecipeManifest, RECIPE_MANIFEST_PATH, type RecipeManifest } from './recipe-schema.ts'
import { normalizeRepoPath } from './recipe-glob.ts'
import type { readRepoFile, RecipeRepo, RecipeRepoResolution } from './recipe-github.ts'
import { scanForSecrets } from './secret-scan.ts'

type Db = ReturnType<typeof getServiceClient>

export const RECIPE_CHANGE_ELEMENTS = ['design', 'gates', 'env', 'routes', 'store', 'release'] as const
export type RecipeChangeElement = (typeof RECIPE_CHANGE_ELEMENTS)[number]
export const MAX_BATCH_REPOS = 10
const MAX_FILE_BYTES = 512 * 1024

/** A job in one of these states is finished; the stream and the console stop there. */
export const RECIPE_JOB_TERMINAL = ['pr_opened', 'failed', 'rejected'] as const
export type RecipeJobStatus = 'queued' | 'running' | (typeof RECIPE_JOB_TERMINAL)[number]
/** A queued or running job older than this never finished (the isolate stopped); it reads as failed. */
export const STUCK_JOB_MS = 10 * 60 * 1000
export const STUCK_JOB_ERROR = 'The change did not finish (the function stopped before opening the PR). Preview it again.'

export interface RecipeEdit {
  path: string
  content: string
  reason?: string
  /** Blob SHA the caller previewed against; null means the file did not exist. Omitted = not checked. */
  baseSha?: string | null
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
  /** `baseSha`: the blob SHA the diff was taken against (null = new file); send it back to guard the confirm. */
  files: Array<{ path: string; diff: string; additions: number; deletions: number; reason: string; before: string; after: string; baseSha: string | null }>
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
  const inventoryPath = inventoryPathOf(manifest)

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
    const moved = baseMoved(e.baseSha, current.kind === 'file' ? current.sha : null)
    if (moved) { denied.push({ path: check.path, reason: `${moved} on ${head.branch} since the preview; reload it and preview again` }); continue }
    const before = current.kind === 'file' ? current.text : ''
    const d = unifiedDiff(check.path, before, e.content)
    if (d.additions + d.deletions === 0) continue
    const broken = contentProblem(check.path, e.content, inventoryPath)
    if (broken) { denied.push({ path: check.path, reason: broken }); continue }
    files.push({ path: check.path, diff: d.diff, additions: d.additions, deletions: d.deletions, reason: e.reason ?? `update ${check.path}`, before, after: e.content, baseSha: current.kind === 'file' ? current.sha : null })
  }
  return { ok: true, reason: null, files, denied, repo: repo.repo, head }
}

function isInventoryFile(path: string, inventoryPath: string | null): boolean {
  return path === inventoryPath || /(^|\/)inventory\.ya?ml$/.test(path)
}

/**
 * Why the new content would break something Mushi parses once merged, or null.
 * mushi.recipe.json goes through the same parse as a refresh; an inventory
 * file through the same validation as inventory ingest.
 */
export function contentProblem(path: string, content: string, inventoryPath: string | null): string | null {
  if (path === RECIPE_MANIFEST_PATH) {
    const parsed = parseRecipeManifest(content)
    if (parsed.ok) return null
    return `the new mushi.recipe.json would not load, so nothing would be writable after the merge: ${parsed.issues.slice(0, 2).map((i) => i.message).join('; ')}`.slice(0, 400)
  }
  if (isInventoryFile(path, inventoryPath)) {
    const parsed = parseInventoryYaml(content)
    if (parsed.ok) return null
    return `the new inventory would fail inventory ingest: ${parsed.issues.slice(0, 2).map((i) => `${i.path}: ${i.message}`).join('; ')}`.slice(0, 400)
  }
  return null
}

/** Why a file no longer matches the SHA the caller previewed against, or null when it still does (or was not checked). */
export function baseMoved(baseSha: string | null | undefined, liveSha: string | null): string | null {
  if (baseSha === undefined) return null
  if (baseSha === null) return liveSha === null ? null : 'this file was created'
  if (liveSha === null) return 'this file was deleted'
  return liveSha === baseSha ? null : 'this file changed'
}

export interface JobResult {
  jobId: string
  projectId: string
  status: 'pr_opened' | 'failed' | 'rejected'
  prUrl: string | null
  error: string | null
}

export interface RecipeChangeInput {
  projectId: string
  element: RecipeChangeElement
  edits: readonly RecipeEdit[]
  title: string
  requestedBy: string
  batchId?: string | null
}

export type CreatedJob =
  | { ok: true; jobId: string }
  /** `activeJobId`: the job already running for this element, so the caller can follow it. */
  | { ok: false; result: JobResult; activeJobId: string | null }

/**
 * Insert the job row. A queued or running row older than STUCK_JOB_MS for the
 * same element is closed as failed first: otherwise one isolate that died
 * mid-job would block that part of the recipe forever (one active job per
 * project and element is a unique index).
 */
export async function createRecipeChangeJob(db: Db, input: RecipeChangeInput, now: Date): Promise<CreatedJob> {
  const cutoff = new Date(now.getTime() - STUCK_JOB_MS).toISOString()
  await db.from('recipe_change_jobs')
    .update({ status: 'failed', error: STUCK_JOB_ERROR, finished_at: now.toISOString(), updated_at: now.toISOString() })
    .eq('project_id', input.projectId).eq('element', input.element).in('status', ['queued', 'running']).lt('created_at', cutoff)
  const { data: job, error: jobErr } = await db.from('recipe_change_jobs').insert({
    project_id: input.projectId, element: input.element, status: 'queued', requested_by: input.requestedBy, batch_id: input.batchId ?? null,
    plan: { element: input.element, paths: input.edits.map((e) => e.path) },
  }).select('id').single()
  if (jobErr || !job) {
    const busy = jobErr?.code === '23505'
    let activeJobId: string | null = null
    if (busy) {
      const { data: active } = await db.from('recipe_change_jobs').select('id').eq('project_id', input.projectId).eq('element', input.element).in('status', ['queued', 'running']).maybeSingle()
      activeJobId = (active as { id?: string } | null)?.id ?? null
    }
    return {
      ok: false,
      activeJobId,
      result: { jobId: activeJobId ?? '', projectId: input.projectId, status: 'rejected', prUrl: null, error: busy ? 'A change for this part of the recipe is already running.' : 'The job could not be created.' },
    }
  }
  return { ok: true, jobId: (job as { id: string }).id }
}

/** Run a created job end to end. Never throws; the job row records what happened. */
export async function executeRecipeChangeJob(db: Db, jobId: string, input: RecipeChangeInput, deps: ChangeDeps): Promise<JobResult> {
  const done = async (status: JobResult['status'], patch: Record<string, unknown>, error: string | null, prUrl: string | null = null): Promise<JobResult> => {
    await db.from('recipe_change_jobs').update({ status, error, finished_at: deps.now().toISOString(), updated_at: deps.now().toISOString(), ...patch }).eq('id', jobId)
    return { jobId, projectId: input.projectId, status, prUrl, error }
  }
  try {
    await db.from('recipe_change_jobs').update({ status: 'running', started_at: deps.now().toISOString(), updated_at: deps.now().toISOString() }).eq('id', jobId)
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

/** Run one job end to end, in the request. Never throws; the job row records what happened. */
export async function runRecipeChange(db: Db, input: RecipeChangeInput, deps: ChangeDeps): Promise<JobResult> {
  const created = await createRecipeChangeJob(db, input, deps.now())
  if (!created.ok) return created.result
  return executeRecipeChangeJob(db, created.jobId, input, deps)
}

// ── Following a job ──────────────────────────────────────────────────────────

export interface RecipeJobRow {
  id: string
  element: string
  status: string
  pr_url: string | null
  pr_number: number | null
  branch: string | null
  error: string | null
  batch_id?: string | null
  created_at: string
  started_at?: string | null
  finished_at: string | null
}

/** A queued or running row past STUCK_JOB_MS reads as failed, never as running forever. */
export function effectiveJobRow<T extends Pick<RecipeJobRow, 'status' | 'created_at' | 'error'>>(row: T, now: Date): T {
  if ((row.status === 'queued' || row.status === 'running') && now.getTime() - Date.parse(row.created_at) > STUCK_JOB_MS) {
    return { ...row, status: 'failed', error: STUCK_JOB_ERROR }
  }
  return row
}

export function isTerminalJobStatus(status: string): boolean {
  return (RECIPE_JOB_TERMINAL as readonly string[]).includes(status)
}

export interface RecipeJobStreamIo {
  /** The job row, or null when it is gone. Throws when the read itself failed. */
  load: () => Promise<RecipeJobRow | null>
  /** Write one SSE event (already formatted by the caller's encoder). */
  emit: (event: 'status' | 'done' | 'error' | 'heartbeat', payload: Record<string, unknown>) => Promise<void>
  sleep: (ms: number) => Promise<void>
  aborted: () => boolean
  now: () => Date
  sanitize: (s: string) => string
}

/**
 * The SSE loop behind GET /recipe/changes/:jobId/stream (mirrors the
 * sdk-upgrade stream): a `status` event on every status change, `done` once
 * the job is terminal, a heartbeat every `heartbeatMs`, and an `error`
 * (STREAM_TIMEOUT) after `maxMs` so the client reconnects or polls. A
 * failed read ends the stream with an `error` (DB_ERROR), never a silent
 * "still running".
 */
export async function streamRecipeChangeJob(io: RecipeJobStreamIo, opts: { pollMs?: number; heartbeatMs?: number; maxMs?: number } = {}): Promise<void> {
  const pollMs = opts.pollMs ?? 1_500
  const heartbeatMs = opts.heartbeatMs ?? 15_000
  const maxMs = opts.maxMs ?? STUCK_JOB_MS
  let elapsed = 0
  let last = ''
  while (elapsed < maxMs && !io.aborted()) {
    let raw: RecipeJobRow | null
    try {
      raw = await io.load()
    } catch {
      await io.emit('error', { code: 'DB_ERROR', message: 'The job could not be read. Try again in a minute.' })
      return
    }
    if (!raw) {
      await io.emit('error', { code: 'NOT_FOUND' })
      return
    }
    const row = effectiveJobRow(raw, io.now())
    if (row.status !== last) {
      last = row.status
      await io.emit('status', {
        status: row.status,
        prUrl: row.pr_url,
        prNumber: row.pr_number,
        branch: row.branch,
        startedAt: row.started_at ?? null,
        finishedAt: row.finished_at,
        error: row.error ? io.sanitize(row.error).slice(0, 500) : null,
      })
    }
    if (isTerminalJobStatus(row.status)) {
      await io.emit('done', { done: true })
      return
    }
    if (elapsed % heartbeatMs < pollMs) await io.emit('heartbeat', {})
    await io.sleep(pollMs)
    elapsed += pollMs
  }
  if (!io.aborted()) await io.emit('error', { code: 'STREAM_TIMEOUT', message: 'Reconnect to keep watching' })
}

// ── What the console's forms edit ────────────────────────────────────────────

export const RECIPE_SOURCE_ELEMENTS = ['gates', 'env', 'routes'] as const
export type RecipeSourceElement = (typeof RECIPE_SOURCE_ELEMENTS)[number]

/**
 * The only files a console form reads per element. Never a caller-chosen path:
 * the inventory is the one mushi.recipe.json names in `routes.inventory`
 * (the file the host's CI ingests), else inventory.yaml. null when that
 * declared path is unsafe.
 */
export function recipeSourceFiles(element: RecipeSourceElement, manifest: RecipeManifest): string[] | null {
  if (element === 'gates') return [RECIPE_MANIFEST_PATH]
  if (element === 'env') return [RECIPE_MANIFEST_PATH, '.env.example']
  const inventory = inventoryPathOf(manifest)
  return inventory ? [inventory] : null
}

export interface RecipeSourceFile {
  path: string
  exists: boolean
  /** null when absent, too large, or holding something shaped like a secret. */
  content: string | null
  /** Blob SHA to send back as `baseSha`; null when the file does not exist. */
  sha: string | null
  writable: boolean
  reason: string | null
}

export type RecipeSources =
  | { ok: true; element: RecipeSourceElement; branch: string; headSha: string; files: RecipeSourceFile[] }
  | { ok: false; element: RecipeSourceElement; reason: string; files: [] }

export async function readRecipeSources(db: Db, projectId: string, element: RecipeSourceElement, deps: Pick<ChangeDeps, 'resolveRepo' | 'getDefaultHead' | 'readRepoFile'>): Promise<RecipeSources> {
  const { data: snap } = await db.from('app_recipe_snapshots').select('manifest').eq('project_id', projectId).eq('is_current', true).maybeSingle()
  const manifest = ((snap as { manifest?: RecipeManifest | null } | null)?.manifest) ?? null
  if (!manifest) return { ok: false, element, reason: 'This repo has no valid mushi.recipe.json, so nothing is writable. Add one and refresh the recipe.', files: [] }
  const paths = recipeSourceFiles(element, manifest)
  if (!paths) return { ok: false, element, reason: 'routes.inventory in mushi.recipe.json is not a safe repo path, so the inventory cannot be edited here. Fix it and refresh the recipe.', files: [] }
  const repo = await deps.resolveRepo(db, projectId)
  if (!repo.ok) return { ok: false, element, reason: repo.reason, files: [] }
  const head = await deps.getDefaultHead(repo.repo)
  const files: RecipeSourceFile[] = []
  for (const path of paths) {
    const check = isWritablePath(path, manifest)
    const current = await deps.readRepoFile(repo.repo, head.sha, path, MAX_FILE_BYTES)
    if (current.kind === 'too_large') {
      files.push({ path, exists: true, content: null, sha: null, writable: false, reason: 'The file is over 512 KB, too large to edit from the console.' })
      continue
    }
    if (current.kind === 'absent') {
      files.push({ path, exists: false, content: null, sha: null, writable: check.ok, reason: check.ok ? null : check.reason })
      continue
    }
    const secret = scanForSecrets(current.text)
    if (secret) {
      files.push({ path, exists: true, content: null, sha: current.sha, writable: false, reason: `The file contains something shaped like a ${secret}, so it is not shown or edited here. Remove it from the repo first.` })
      continue
    }
    files.push({ path, exists: true, content: current.text, sha: current.sha, writable: check.ok, reason: check.ok ? null : check.reason })
  }
  return { ok: true, element, branch: head.branch, headSha: head.sha, files }
}
