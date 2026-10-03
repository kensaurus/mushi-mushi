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
 * deploy) → one automatic draft per project at a time (the
 * uq_releases_one_auto_draft index; release-builder answers 409) → publish.
 * A draft that fails to publish stays in the console for a person.
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
  | { status: 'draft_in_progress' }
  | { status: 'published'; releaseId: string; delivery: ReleaseDelivery & { credits_stamped: number; credits_pending: number } }
  | { status: 'failed'; error: string; releaseId?: string }

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

  const drafted = await draft({
    project_id: projectId,
    version,
    title: releaseTitle(trigger, version),
    window_start: windowStart,
    auto_source: trigger.source,
  })
  if (!drafted.ok) {
    if (drafted.busy) return { status: 'draft_in_progress' }
    return { status: 'failed', error: drafted.error }
  }
  if (drafted.reportCount === 0) {
    // Another release took the reports between the check and the draft.
    await db.from('releases').delete().eq('id', drafted.releaseId).eq('status', 'draft')
    return { status: 'nothing_to_release' }
  }

  const published = await publish(db, drafted.releaseId, { kind: 'system', id: `auto-release:${trigger.source}` })
  if (!published.ok) return { status: 'failed', error: published.error, releaseId: drafted.releaseId }
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
      if (outcome.status === 'failed') arLog.error('auto-release failed', { ...fields, error: outcome.error })
      else arLog.info('auto-release', fields)
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
