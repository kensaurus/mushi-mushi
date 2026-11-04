/**
 * FILE: packages/server/supabase/functions/_shared/ci-rerun-permission.ts
 * PURPOSE: Whether Re-run CI would 403 before anyone clicks (report 69fcafcb).
 *
 * A GitHub App states its Actions permission when the installation token is
 * minted. `read` can list runs and still cannot re-run them, so the button
 * is withheld as soon as that answer is known. A fine-grained token's write
 * permission cannot be seen without writing: the 403 is remembered against a
 * hash of that token and keeps applying while the same token is in use. It
 * does not expire, and it does not clear when some other setting is saved.
 * Replacing the token (a different hash, or Actions: write on the App)
 * offers Re-run CI again.
 *
 * A refusal stored before fingerprints existed applies only while Mushi
 * cannot name the current token, and only for `ttlMs`. Once the current
 * token has a fingerprint, that old row stops counting, so replacing the
 * token does not leave the button off.
 *
 * Pure aside from `patRerunFingerprint` (Web Crypto). No Deno globals.
 */

export interface RerunAccess {
  /** The GitHub App's minted permissions lack Actions write. */
  blocks: boolean
  /** `app:<installation>:<level>` or `pat:<hash>`. Null when the token could not be named. */
  fingerprint: string | null
  /**
   * A stored fingerprint could not be compared (the mint or the token read
   * failed). The refusal stays, because a failed read is not a new token.
   */
  unreadable: boolean
}

export interface StoredRerunRefusal {
  at: string
  fingerprint: string | null
}

const FINGERPRINT_RE = /^(?:app:\d+:[a-z0-9_-]{1,32}|pat:[a-f0-9]{32})$/

/** The fingerprint stored on a refusal event, or null when the row has none. */
export function fingerprintFromPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const value = (payload as { tokenFingerprint?: unknown }).tokenFingerprint
  return typeof value === 'string' && FINGERPRINT_RE.test(value) ? value : null
}

/**
 * The App's `actions` level, or null when the mint did not say.
 * `none`: the permission map was present and Actions was not on it.
 */
export function actionsLevel(permissions: Record<string, unknown> | null | undefined): string | null {
  if (!permissions || Object.keys(permissions).length === 0) return null
  const level = permissions.actions
  return typeof level === 'string' && /^[a-z0-9_-]{1,32}$/.test(level) ? level : 'none'
}

/** True when a minted permission map shows Actions write was not granted. */
export function installationBlocksRerun(permissions: Record<string, unknown> | null | undefined): boolean {
  const level = actionsLevel(permissions)
  if (level === null) return false
  return level !== 'write' && level !== 'admin'
}

export function appRerunFingerprint(installationId: number, level: string): string {
  return `app:${installationId}:${level}`
}

/** Identity of a personal access token. The hash is not the token. */
export async function patRerunFingerprint(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  let hex = ''
  for (const b of new Uint8Array(digest)) hex += b.toString(16).padStart(2, '0')
  return `pat:${hex.slice(0, 32)}`
}

export function rerunCiBlocked(input: {
  nowMs: number
  ttlMs: number
  blocks: boolean
  fingerprint: string | null
  unreadable: boolean
  refusals: readonly StoredRerunRefusal[]
}): boolean {
  if (input.blocks) return true
  for (const refusal of input.refusals) {
    if (refusal.fingerprint) {
      if (input.unreadable || (input.fingerprint !== null && refusal.fingerprint === input.fingerprint)) return true
      continue
    }
    // No fingerprint: the row cannot tell a replaced token from the old one.
    if (input.fingerprint) continue
    const at = Date.parse(refusal.at)
    if (Number.isFinite(at) && at <= input.nowMs && input.nowMs - at < input.ttlMs) return true
  }
  return false
}

export function projectsRerunRefused(
  projectIds: readonly string[],
  access: ReadonlyMap<string, RerunAccess>,
  refusals: readonly (StoredRerunRefusal & { project_id: string })[],
  nowMs: number,
  ttlMs: number,
): Set<string> {
  const byProject = new Map<string, StoredRerunRefusal[]>()
  for (const refusal of refusals) {
    const list = byProject.get(refusal.project_id) ?? []
    list.push({ at: refusal.at, fingerprint: refusal.fingerprint })
    byProject.set(refusal.project_id, list)
  }
  const out = new Set<string>()
  for (const id of projectIds) {
    const known = access.get(id) ?? { blocks: false, fingerprint: null, unreadable: false }
    if (rerunCiBlocked({ nowMs, ttlMs, ...known, refusals: byProject.get(id) ?? [] })) out.add(id)
  }
  return out
}

export interface RepoInstallRow {
  project_id: string
  repo_url: string | null
  is_primary?: boolean | null
  github_app_installation_id: unknown
}

export function toInstallationId(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN
  return Number.isSafeInteger(n) && n > 0 ? n : null
}

/** `owner/repo` from a GitHub repo or pull-request URL, lowercased. */
export function githubRepoKey(url: string | null | undefined): string | null {
  if (!url) return null
  const match = /github\.com\/([^/\s]+)\/([^/\s#?]+?)(?:\.git)?(?:\/.*)?$/i.exec(url.trim())
  if (!match) return null
  return `${match[1]}/${match[2]}`.toLowerCase()
}

/**
 * Installations Mushi would mint for this app's open pull requests.
 * A pull request whose repo row has no installation is a personal access
 * token, not the primary repo's App. Empty: every open pull request uses a token.
 */
export function installationIdsForProject(
  repos: readonly RepoInstallRow[],
  attempts: readonly { project_id: string; pr_url: string | null; pr_state: string | null }[],
  projectId: string,
): number[] {
  const rows = repos.filter((row) => row.project_id === projectId)
  const ids = new Set<number>()
  for (const attempt of attempts) {
    if (attempt.project_id !== projectId || !attempt.pr_url) continue
    if (attempt.pr_state !== 'open' && attempt.pr_state !== 'draft') continue
    const key = githubRepoKey(attempt.pr_url)
    const matched = key ? rows.find((row) => githubRepoKey(row.repo_url) === key) : undefined
    const row = matched ?? (key ? undefined : rows.find((candidate) => candidate.is_primary))
    const id = toInstallationId(row?.github_app_installation_id)
    if (id) ids.add(id)
  }
  return [...ids]
}

export interface RerunProbeIo {
  repos(projectIds: readonly string[]): Promise<RepoInstallRow[]>
  /** Null when the mint did not answer in time. */
  mint(installationId: number): Promise<{ permissions: Record<string, unknown> | null } | null>
  /** The personal access token, or null. Callers hash it and drop it. */
  pat(projectId: string): Promise<string | null>
}

const OPEN = (attempt: { pr_url: string | null; pr_state: string | null }) =>
  !!attempt.pr_url && (attempt.pr_state === 'open' || attempt.pr_state === 'draft')

/**
 * What each app's re-run token can do, from installation permissions and,
 * only after a refusal, a hash of the personal access token. Never writes.
 */
export async function probeRerunAccess(
  projectIds: readonly string[],
  attempts: readonly { project_id: string; pr_url: string | null; pr_state: string | null }[],
  refusals: readonly { project_id: string; fingerprint: string | null }[],
  io: RerunProbeIo,
): Promise<Map<string, RerunAccess>> {
  const out = new Map<string, RerunAccess>()
  const openProjects = new Set(attempts.filter(OPEN).map((attempt) => attempt.project_id))
  const todo = projectIds.filter((id) => openProjects.has(id))
  if (todo.length === 0) return out
  const repos = await io.repos(todo)
  const installs = new Map<string, number[]>()
  for (const id of todo) installs.set(id, installationIdsForProject(repos, attempts, id))
  const minted = new Map<number, { permissions: Record<string, unknown> | null } | null>()
  await Promise.all(
    [...new Set([...installs.values()].flat())].map(async (id) => {
      minted.set(id, await io.mint(id).catch(() => null))
    }),
  )
  await Promise.all(
    todo.map(async (projectId) => {
      const ids = installs.get(projectId) ?? []
      const mine = refusals.filter((refusal) => refusal.project_id === projectId)
      const hasFingerprint = mine.some((refusal) => refusal.fingerprint)
      if (ids.length > 0) {
        let blocks = false
        let failed = false
        let level: string | null = null
        for (const id of ids) {
          const mintedAccess = minted.get(id)
          const permissions = mintedAccess?.permissions
          if (!mintedAccess || !permissions || Object.keys(permissions).length === 0) {
            failed = true
            continue
          }
          const next = actionsLevel(permissions)
          if (next && installationBlocksRerun(permissions)) blocks = true
          if (ids.length === 1) level = next
        }
        if (blocks) {
          out.set(projectId, {
            blocks: true,
            fingerprint: ids.length === 1 && level ? appRerunFingerprint(ids[0]!, level) : null,
            unreadable: false,
          })
          return
        }
        if (ids.length === 1 && level) {
          out.set(projectId, { blocks: false, fingerprint: appRerunFingerprint(ids[0]!, level), unreadable: false })
          return
        }
        if (failed && mine.length > 0) out.set(projectId, { blocks: false, fingerprint: null, unreadable: hasFingerprint })
        return
      }
      if (mine.length === 0) return
      const token = await io.pat(projectId).catch(() => null)
      if (token) {
        out.set(projectId, { blocks: false, fingerprint: await patRerunFingerprint(token), unreadable: false })
        return
      }
      out.set(projectId, { blocks: false, fingerprint: null, unreadable: hasFingerprint })
    }),
  )
  return out
}
