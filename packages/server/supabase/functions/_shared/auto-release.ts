/**
 * FILE: packages/server/supabase/functions/_shared/auto-release.ts
 * PURPOSE: Opt-in "release without manual steps". When the host ships —
 *          a GitHub `release` published, a successful production
 *          `deployment_status`, or `release.published` on
 *          POST /v1/ingest/recipe/events — draft a Mushi release from the
 *          fixed, not-yet-released reports and publish it, which tells each
 *          reporter their bug shipped (release-publish.ts).
 *
 * Off unless `project_settings.auto_release_enabled` is true; an unreadable
 * setting counts as off, because publishing messages real reporters.
 *
 * Guards, in order: opt-in → a release with this version already exists →
 * nothing fixed since the last published release (no empty releases on every
 * deploy) → one automatic draft per project at a time (checked before
 * drafting, so a blocked trigger spends no release-builder call; the
 * uq_releases_one_auto_draft index and release-builder's 409 close the race)
 * → publish.
 *
 * Failure modes, as the outcome reports them:
 *   - the draft could not be made: nothing was written (`failed`);
 *   - the draft was made but publishing failed before its status flipped:
 *     the draft stays under Drafts (`failed`, published: false). It also
 *     blocks every later auto-release until a person publishes or deletes
 *     it, so the console (GET /v1/admin/releases/auto-release) shows it and
 *     the log turns to a warning once it is older than AUTO_DRAFT_STALE_MS;
 *   - the release went live but linking tickets, telling reporters or
 *     stamping credits failed part-way (`failed`, published: true): some
 *     reporters may not have been told.
 *
 * No Deno globals at module scope, so vitest imports it with injected deps.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { log } from './logger.ts'
import { publishRelease, type PublishReleaseResult } from './release-publish.ts'
import type { ReleaseDelivery } from './release-reporters.ts'

const arLog = log.child('auto-release')

export type AutoReleaseSource = 'github_release' | 'github_deployment' | 'recipe_event'

export interface AutoReleaseTrigger {
  source: AutoReleaseSource
  /** What reporters see as "fixed in version …". */
  version: string
  title?: string
  commit?: string | null
}

export type AutoReleaseOutcome =
  | { status: 'disabled' }
  | { status: 'duplicate'; releaseId: string }
  | { status: 'nothing_to_release' }
  | { status: 'draft_in_progress'; blocking: OpenAutoDraft | null }
  | { status: 'published'; releaseId: string; delivery: ReleaseDelivery & { credits_stamped: number; credits_pending: number } }
  | { status: 'failed'; error: string; releaseId?: string; published?: boolean }

/** The automatic draft that holds uq_releases_one_auto_draft for a project. */
export interface OpenAutoDraft {
  id: string
  version: string
  createdAt: string
  autoSource: AutoReleaseSource
  /** Older than AUTO_DRAFT_STALE_MS: no run is still working on it. */
  stale: boolean
}

export interface AutoReleaseDraftInput {
  project_id: string
  version: string
  title: string
  window_start: string
  auto_source: AutoReleaseSource
}

export type AutoReleaseDraftResult =
  | { ok: true; releaseId: string; reportCount: number }
  | { ok: false; busy?: boolean; error: string }

export interface AutoReleaseDeps {
  draft?: (input: AutoReleaseDraftInput) => Promise<AutoReleaseDraftResult>
  publish?: (db: SupabaseClient, releaseId: string, actor: { kind: 'system'; id: string }) => Promise<PublishReleaseResult>
  now?: () => Date
}

/** With no published release yet, look back as far as release-builder does. */
export const AUTO_RELEASE_DEFAULT_WINDOW_DAYS = 30
/**
 * An automatic draft lives for one release-builder call plus one publish
 * (seconds). Older than this, the run that made it is gone and the draft
 * blocks auto-release until a person acts.
 */
export const AUTO_DRAFT_STALE_MS = 10 * 60 * 1000
/** A tag, semver or short sha: what a reporter may see as "fixed in …". */
export const AUTO_RELEASE_VERSION_RE = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/

// ─── Trigger parsing (pure) ──────────────────────────────────────────────────

/** `release` webhook → trigger, for `published` non-draft, non-prerelease releases only. */
export function triggerFromGithubRelease(payload: {
  action?: string
  release?: { tag_name?: string | null; name?: string | null; draft?: boolean; prerelease?: boolean; target_commitish?: string | null }
}): AutoReleaseTrigger | null {
  if (payload.action !== 'published') return null
  const rel = payload.release
  if (!rel || rel.draft || rel.prerelease) return null
  const version = (rel.tag_name ?? '').trim()
  if (!version) return null
  const name = (rel.name ?? '').trim()
  return { source: 'github_release', version, title: name || undefined, commit: rel.target_commitish ?? null }
}

const VERSION_REF_RE = /^v?\d+(\.\d+){1,3}([-+][0-9A-Za-z.-]+)?$/

/**
 * `deployment_status` webhook → trigger, for a `success` in a production
 * environment only (preview and staging deploys are not a release). The
 * version is the deployed ref when it is a version tag, else the short sha.
 */
export function triggerFromGithubDeploymentStatus(payload: {
  deployment_status?: { state?: string | null; environment?: string | null }
  deployment?: { sha?: string | null; ref?: string | null; environment?: string | null; production_environment?: boolean | null }
}): AutoReleaseTrigger | null {
  if (payload.deployment_status?.state !== 'success') return null
  const dep = payload.deployment
  if (!dep) return null
  const environment = (payload.deployment_status?.environment ?? dep.environment ?? '').trim()
  const production = dep.production_environment === true || /^prod(uction)?$/i.test(environment)
  if (!production) return null
  const sha = (dep.sha ?? '').trim()
  const ref = (dep.ref ?? '').trim()
  if (VERSION_REF_RE.test(ref)) return { source: 'github_deployment', version: ref, commit: sha || null }
  if (!/^[0-9a-f]{7,64}$/i.test(sha)) return null
  const short = sha.slice(0, 7)
  return { source: 'github_deployment', version: short, title: `Deployed ${short}`, commit: sha }
}

function releaseTitle(trigger: AutoReleaseTrigger, version: string): string {
  // Only the GitHub release name (written by the repo's maintainers on a
  // signed delivery) or a fixed "Deployed <sha>" arrives as a title; the CI
  // push path never sets one.
  if (trigger.title?.trim()) return trigger.title.trim().slice(0, 200)
  return /^v\d/i.test(version) ? version : `v${version}`
}

// ─── Default draft: the release-builder edge function ───────────────────────

// Deno global — edge-function runtime only (absent under vitest).
declare const Deno: { env: { get(name: string): string | undefined } }

async function draftViaReleaseBuilder(input: AutoReleaseDraftInput): Promise<AutoReleaseDraftResult> {
  const env = typeof Deno !== 'undefined' ? Deno.env : null
  const url = env?.get('SUPABASE_URL')
  const key = env?.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) return { ok: false, error: 'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set' }
  let res: Response
  try {
    res = await fetch(`${url}/functions/v1/release-builder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(90_000),
    })
  } catch (err) {
    return { ok: false, error: `release-builder unreachable: ${String(err).slice(0, 200)}` }
  }
  const text = await res.text()
  let body: { error?: unknown; data?: { release?: { id?: string }; reportCount?: number } } = {}
  try {
    body = JSON.parse(text)
  } catch {
    return { ok: false, error: `release-builder returned non-JSON (${res.status}): ${text.slice(0, 120)}` }
  }
  if (res.status === 409) return { ok: false, busy: true, error: String(body.error ?? 'automatic draft already open') }
  const releaseId = body.data?.release?.id
  if (!res.ok || !releaseId) return { ok: false, error: String(body.error ?? `release-builder ${res.status}`).slice(0, 300) }
  return { ok: true, releaseId, reportCount: body.data?.reportCount ?? 0 }
}

// ─── The blocking draft ──────────────────────────────────────────────────────

/**
 * The project's open automatic draft, if any. A read error is returned, never
 * read as "none": a caller that guessed "none" would draft a second release.
 */
export async function findOpenAutoDraft(
  db: SupabaseClient,
  projectId: string,
  now: Date,
): Promise<{ ok: true; draft: OpenAutoDraft | null } | { ok: false; error: string }> {
  const { data, error } = await db
    .from('releases')
    .select('id, version, created_at, auto_source')
    .eq('project_id', projectId)
    .eq('status', 'draft')
    .not('auto_source', 'is', null)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (error) return { ok: false, error: `reading automatic drafts failed: ${error.message}` }
  if (!data) return { ok: true, draft: null }
  const row = data as { id: string; version: string; created_at: string; auto_source: AutoReleaseSource }
  const age = now.getTime() - new Date(row.created_at).getTime()
  return {
    ok: true,
    draft: {
      id: row.id,
      version: row.version,
      createdAt: row.created_at,
      autoSource: row.auto_source,
      stale: Number.isFinite(age) && age > AUTO_DRAFT_STALE_MS,
    },
  }
}

// ─── Orchestration ───────────────────────────────────────────────────────────

export async function runAutoRelease(
  db: SupabaseClient,
  projectId: string,
  trigger: AutoReleaseTrigger,
  deps: AutoReleaseDeps = {},
): Promise<AutoReleaseOutcome> {
  const draft = deps.draft ?? draftViaReleaseBuilder
  const publish = deps.publish ?? publishRelease
  const now = (deps.now ?? (() => new Date()))()

  const { data: settings, error: settingsErr } = await db
    .from('project_settings')
    .select('auto_release_enabled')
    .eq('project_id', projectId)
    .maybeSingle()
  if (settingsErr) {
    arLog.warn('auto_release_enabled unreadable; treating auto-release as off', { projectId, err: settingsErr.message })
    return { status: 'disabled' }
  }
  if ((settings as { auto_release_enabled?: boolean } | null)?.auto_release_enabled !== true) return { status: 'disabled' }

  // The version lands in every reporter's "fixed in …" message and can come
  // from a CI push, so only a plain version string is accepted.
  const version = trigger.version.trim()
  if (!AUTO_RELEASE_VERSION_RE.test(version)) {
    return { status: 'failed', error: `"${version.slice(0, 40)}" is not a version (letters, digits, . _ + - only, at most 64)` }
  }

  const { data: existing, error: existingErr } = await db
    .from('releases')
    .select('id')
    .eq('project_id', projectId)
    .eq('version', version)
    .limit(1)
    .maybeSingle()
  if (existingErr) return { status: 'failed', error: `reading releases failed: ${existingErr.message}` }
  if (existing) return { status: 'duplicate', releaseId: (existing as { id: string }).id }

  const { data: lastPublished, error: lastErr } = await db
    .from('releases')
    .select('published_at')
    .eq('project_id', projectId)
    .eq('status', 'published')
    .order('published_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (lastErr) return { status: 'failed', error: `reading the last release failed: ${lastErr.message}` }
  const windowStart =
    (lastPublished as { published_at?: string | null } | null)?.published_at ??
    new Date(now.getTime() - AUTO_RELEASE_DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()

  // Same selection release-builder makes: fixed, not shipped by an earlier
  // release, touched since the window start. None → no release at all.
  const { data: candidates, error: candErr } = await db
    .from('reports')
    .select('id')
    .eq('project_id', projectId)
    .eq('status', 'fixed')
    .is('fixed_release_id', null)
    .gte('updated_at', windowStart)
    .limit(1)
  if (candErr) return { status: 'failed', error: `reading fixed reports failed: ${candErr.message}` }
  if (!candidates || (candidates as unknown[]).length === 0) return { status: 'nothing_to_release' }

  const open = await findOpenAutoDraft(db, projectId, now)
  if (!open.ok) return { status: 'failed', error: open.error }
  if (open.draft) return { status: 'draft_in_progress', blocking: open.draft }

  const drafted = await draft({
    project_id: projectId,
    version,
    title: releaseTitle(trigger, version),
    window_start: windowStart,
    auto_source: trigger.source,
  })
  if (!drafted.ok) {
    if (drafted.busy) {
      // Lost the race to another trigger between the check and the insert.
      const raced = await findOpenAutoDraft(db, projectId, now)
      return { status: 'draft_in_progress', blocking: raced.ok ? raced.draft : null }
    }
    return { status: 'failed', error: drafted.error }
  }
  if (drafted.reportCount === 0) {
    // Another release took the reports between the check and the draft.
    await db.from('releases').delete().eq('id', drafted.releaseId).eq('status', 'draft')
    return { status: 'nothing_to_release' }
  }

  const published = await publish(db, drafted.releaseId, { kind: 'system', id: `auto-release:${trigger.source}` })
  if (!published.ok) {
    return { status: 'failed', error: published.error, releaseId: drafted.releaseId, published: published.published }
  }
  return { status: 'published', releaseId: drafted.releaseId, delivery: published.delivery }
}

/**
 * Fire-and-forget for webhook handlers (GitHub waits 10 s): runs under the
 * edge runtime's waitUntil when present and logs the outcome. Never throws.
 */
export function scheduleAutoRelease(
  db: SupabaseClient,
  projectId: string,
  trigger: AutoReleaseTrigger,
  deps: AutoReleaseDeps = {},
): Promise<AutoReleaseOutcome | null> {
  const run = runAutoRelease(db, projectId, trigger, deps)
    .then((outcome) => {
      const fields = { projectId, source: trigger.source, version: trigger.version, status: outcome.status }
      if (outcome.status === 'failed') {
        arLog.error(
          outcome.published ? 'auto-release published, but reporter delivery failed part-way' : 'auto-release failed',
          { ...fields, error: outcome.error, releaseId: outcome.releaseId ?? null },
        )
      } else if (outcome.status === 'draft_in_progress' && (outcome.blocking?.stale ?? true)) {
        // A stale (or unreadable) blocking draft is not a run in progress: it
        // stops every auto-release until a person publishes or deletes it.
        arLog.warn('auto-release blocked by an automatic draft nobody published', {
          ...fields,
          blockingReleaseId: outcome.blocking?.id ?? null,
          blockingVersion: outcome.blocking?.version ?? null,
          blockingSince: outcome.blocking?.createdAt ?? null,
        })
      } else arLog.info('auto-release', fields)
      return outcome
    })
    .catch((err) => {
      arLog.error('auto-release threw', { projectId, source: trigger.source, err: String(err).slice(0, 300) })
      return null
    })
  const edgeRuntime = (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime
  if (edgeRuntime?.waitUntil) edgeRuntime.waitUntil(run)
  return run
}

// ─── GitHub App webhook: release / deployment_status ────────────────────────

export type GithubShipPayload = Parameters<typeof triggerFromGithubRelease>[0] &
  Parameters<typeof triggerFromGithubDeploymentStatus>[0] & {
    repository?: { full_name?: string }
    installation?: { id?: number }
  }

export interface GithubShipRouting {
  /** HTTP status for GitHub: 202 handled or ignored, 500 so GitHub redelivers. */
  status: 202 | 500
  body: Record<string, unknown>
  /** Projects an auto-release was scheduled for (the audit row takes the first). */
  projectIds: string[]
}

/**
 * Route a `release` / `deployment_status` delivery from the Mushi GitHub App
 * to the projects bound to that repo under THAT installation (the same
 * routing as push, without requiring indexing). A failed lookup is a 500 so
 * GitHub redelivers: answering "no project" would drop a real ship.
 */
export async function routeGithubShipEvent(
  db: SupabaseClient,
  event: 'release' | 'deployment_status',
  payload: GithubShipPayload,
  schedule: (db: SupabaseClient, projectId: string, trigger: AutoReleaseTrigger) => unknown = scheduleAutoRelease,
): Promise<GithubShipRouting> {
  const trigger = event === 'release' ? triggerFromGithubRelease(payload) : triggerFromGithubDeploymentStatus(payload)
  if (!trigger) return { status: 202, body: { ok: true, ignored: `${event}_not_a_production_ship` }, projectIds: [] }
  const installationId = payload.installation?.id
  const repo = payload.repository?.full_name
  if (!installationId || !repo) {
    return { status: 202, body: { ok: true, ignored: 'missing_repo_or_installation' }, projectIds: [] }
  }
  const { data, error } = await db
    .from('project_repos')
    .select('project_id')
    .eq('repo_url', `https://github.com/${repo}`)
    .eq('github_app_installation_id', installationId)
    .limit(10)
  if (error) {
    arLog.error('auto-release: project_repos lookup failed', { event, repo, err: error.message })
    return { status: 500, body: { ok: false, error: 'project_repos lookup failed; redeliver' }, projectIds: [] }
  }
  const projectIds = [...new Set(((data ?? []) as Array<{ project_id: string }>).map((r) => r.project_id))]
  if (projectIds.length === 0) {
    return { status: 202, body: { ok: true, ignored: 'no_project_for_repo', repoFullName: repo }, projectIds }
  }
  for (const pid of projectIds) void schedule(db, pid, trigger)
  return { status: 202, body: { ok: true, autoRelease: { queued: projectIds.length, version: trigger.version } }, projectIds }
}
