/**
 * FILE: packages/server/supabase/functions/_shared/setup-gaps.ts
 * PURPOSE: Setup gaps (console ops plan 2026-10-27, P1 "See it"): the owner
 *          configuration that is missing or broken for an app, found before
 *          something fails with a 403. Each gap used to surface only when a
 *          button failed, on a different page each time:
 *
 *            - GITHUB_ACTIONS_WRITE_MISSING when a CI re-run was refused
 *              (api/routes/ci.ts), GH_SECRETS_FORBIDDEN when CI secrets could
 *              not be written (api/routes/project-ci-secrets.ts);
 *            - review follow-ups turned off because their key was deleted
 *              (review_followup_off_reason);
 *            - auto-fix on with no Cursor key that can dispatch (/pipeline's
 *              FixOpeners problem, pipeline-view.ts buildDispatchers);
 *            - no deploy event, so reporters are never told their fix is
 *              live (report 9f64a77b);
 *            - a Slack bot token Slack no longer accepts.
 *
 *          Every check returns a line, also when it passes or could not be
 *          read: a check that could not be read is `unknown` with what was
 *          not read, never left out (a missing line would read as "fine").
 *          Server secrets only the operator can set are in
 *          platform-setup-checks.ts (audience 'platform', super-admin doctor).
 *
 * Pure: no Deno globals, no npm: specifiers, so vitest imports it directly.
 * The route (api/routes/setup-gaps.ts) does the reads and the GitHub probes.
 */

export type GapAudience = 'app_owner' | 'platform'
export type GapStatus = 'ok' | 'gap' | 'unknown'

export interface SetupGap {
  id: string
  projectId: string | null
  audience: GapAudience
  status: GapStatus
  /** A short name for the line ("GitHub access: kensaurus/glot.it"). */
  title: string
  /** What is wrong and what it breaks, in plain words. */
  summary: string
  /** Where to fix it: a console path, or a docs path for platform checks. */
  fixHref: string
}

export const FIX_HREFS = {
  github: '/connect#connect-github',
  followups: '/settings?tab=byok#review-followups',
  cursorKeys: '/credits#cursor-fix-bugs',
  deploys: '/recipe',
  slack: '/integrations/config',
} as const

const DAY = 24 * 3600_000

/** The 14-day rule: no deploy event in this long means reporters are not being told. */
export const DEPLOY_SILENCE_DAYS = 14
/** Slack is probed every 15 minutes (integration-health-probe); older than this is not a reading. */
export const SLACK_PROBE_STALE_MS = DAY
/** How long a project's checks are reused. */
export const SETUP_GAPS_CACHE_MS = 10 * 60_000

// ── GitHub access ───────────────────────────────────────────────────────────

/** `yes`: proven. `read_only`: reads work, writing was not tried (Mushi never writes to check). */
export type Ability = 'yes' | 'read_only' | 'no' | 'unknown'

export interface TokenAbilities {
  contents: Ability
  pullRequests: Ability
  actions: Ability
  secrets: Ability
}

export type TokenSource = 'app' | 'pat_classic' | 'pat_fine_grained' | 'platform' | 'none'

const ABILITY_WORDS: Record<keyof TokenAbilities, { verb: string; permission: string }> = {
  contents: { verb: 'push fix branches', permission: 'Contents: Read and write' },
  pullRequests: { verb: 'open pull requests', permission: 'Pull requests: Read and write' },
  actions: { verb: 're-run CI', permission: 'Actions: Read and write' },
  secrets: { verb: 'write CI secrets', permission: 'Secrets: Read and write' },
}

/** Needed for fixes to reach a PR and for CI re-runs. Secrets are optional: Mushi hands out copy-paste commands instead. */
const CORE: Array<keyof TokenAbilities> = ['contents', 'pullRequests', 'actions']

/** Every ability here is a write; an App permission of `read` means it cannot. */
function level(v: unknown): Ability {
  return v === 'write' || v === 'admin' ? 'yes' : 'no'
}

/**
 * A GitHub App installation token: the access-token mint answers with the
 * installation's permissions. They are installation-wide, so `reachable`
 * (GET /repos/:o/:r with the token) says whether this repo is in it.
 */
export function abilitiesFromInstallation(permissions: Record<string, unknown> | null, reachable: boolean | null): TokenAbilities {
  if (reachable === false) return { contents: 'no', pullRequests: 'no', actions: 'no', secrets: 'no' }
  if (!permissions) return { contents: 'unknown', pullRequests: 'unknown', actions: 'unknown', secrets: 'unknown' }
  return {
    contents: level(permissions.contents),
    pullRequests: level(permissions.pull_requests),
    actions: level(permissions.actions),
    secrets: level(permissions.secrets),
  }
}

/**
 * A classic personal access token: GitHub lists its scopes in
 * `X-OAuth-Scopes` on any answer. `repo` covers contents, pull requests,
 * Actions re-runs and repository secrets; with neither `repo` nor
 * `public_repo` it can only read public repos.
 */
export function abilitiesFromClassicScopes(header: string, reachable: boolean): TokenAbilities {
  if (!reachable) return { contents: 'no', pullRequests: 'no', actions: 'no', secrets: 'no' }
  const scopes = new Set(header.split(',').map((s) => s.trim()).filter(Boolean))
  if (scopes.has('repo')) return { contents: 'yes', pullRequests: 'yes', actions: 'yes', secrets: 'yes' }
  if (scopes.has('public_repo')) return { contents: 'yes', pullRequests: 'yes', actions: 'unknown', secrets: 'no' }
  return { contents: 'no', pullRequests: 'no', actions: 'no', secrets: 'no' }
}

/** HTTP status of a harmless read, or null when it did not answer in time. */
export interface ReadProbes {
  contents: number | null
  pullRequests: number | null
  actions: number | null
  secrets: number | null
}

/**
 * A fine-grained token has no scope header, and its write permissions cannot
 * be seen without writing. So a read that works proves only `read_only`; a
 * 403 or 404 proves the permission is missing.
 */
export function abilitiesFromReadProbes(p: ReadProbes): TokenAbilities {
  const one = (s: number | null): Ability => (s === null ? 'unknown' : s >= 200 && s < 300 ? 'read_only' : s === 403 || s === 404 ? 'no' : 'unknown')
  return { contents: one(p.contents), pullRequests: one(p.pullRequests), actions: one(p.actions), secrets: one(p.secrets) }
}

export interface RepoAccessInput {
  projectId: string
  /** owner/name */
  repo: string
  source: TokenSource
  abilities: TokenAbilities | null
  /** Why it could not be read (a timeout, GitHub 5xx); null when it was. */
  readError: string | null
}

function sourceWords(s: TokenSource): string {
  switch (s) {
    case 'app':
      return 'The Mushi GitHub App'
    case 'pat_classic':
      return 'Your GitHub token'
    case 'pat_fine_grained':
      return 'Your fine-grained GitHub token'
    case 'platform':
      return "Mushi's own fallback token (not yours)"
    default:
      return 'GitHub'
  }
}

/** No repo connected at all: nothing else about GitHub can be checked. */
export function noRepoGap(projectId: string): SetupGap {
  return {
    id: 'github_access',
    projectId,
    audience: 'app_owner',
    status: 'gap',
    title: 'GitHub repo',
    summary: 'No GitHub repo is connected, so Mushi cannot open fix pull requests or read CI for this app.',
    fixHref: FIX_HREFS.github,
  }
}

/** One line per repo: what Mushi's GitHub access there can and cannot do. */
export function githubAccessGap(input: RepoAccessInput): SetupGap {
  const base = { id: `github_access:${input.repo}`, projectId: input.projectId, audience: 'app_owner' as const, title: `GitHub access: ${input.repo}`, fixHref: FIX_HREFS.github }
  if (input.source === 'none') {
    return { ...base, status: 'gap', summary: `No GitHub connection for ${input.repo}: Mushi cannot open fix pull requests or read CI there.` }
  }
  if (input.readError || !input.abilities) {
    return { ...base, status: 'unknown', summary: `Mushi could not check what its GitHub access can do in ${input.repo} (${input.readError ?? 'no answer'}).` }
  }
  const a = input.abilities
  const who = sourceWords(input.source)
  const missing = CORE.filter((k) => a[k] === 'no')
  const unproven = CORE.filter((k) => a[k] === 'unknown' || a[k] === 'read_only')
  const can = CORE.filter((k) => a[k] === 'yes').map((k) => ABILITY_WORDS[k].verb)
  const secretsLine =
    a.secrets === 'yes'
      ? ' It can write CI secrets.'
      : a.secrets === 'no'
        ? " It can't write CI secrets; Mushi gives you copy-paste commands for those instead."
        : ''
  if (missing.length) {
    const list = missing.map((k) => `${ABILITY_WORDS[k].verb} (${ABILITY_WORDS[k].permission})`).join(', ')
    return { ...base, status: 'gap', summary: `${who} in ${input.repo} can't ${list}. Those steps fail until you add it.${secretsLine}` }
  }
  if (unproven.length) {
    const list = unproven.map((k) => ABILITY_WORDS[k].verb).join(', ')
    return {
      ...base,
      status: 'unknown',
      summary: `${who} in ${input.repo} can read, but Mushi can't tell whether it may ${list} without writing, and it never writes to check.${secretsLine}`,
    }
  }
  return { ...base, status: 'ok', summary: `${who} in ${input.repo} can ${can.join(', ')}.${secretsLine}` }
}

// ── Review follow-ups ───────────────────────────────────────────────────────

export interface FollowupKeyInput {
  projectId: string
  /** null: the settings could not be read. */
  settings: { enabled: boolean; offReason: string | null; keyId: string | null } | null
  /** The chosen key's status, null when no row exists (deleted). Undefined when no key is chosen. */
  keyStatus?: string | null
}

export function followupKeyGap(input: FollowupKeyInput): SetupGap {
  const base = { id: 'review_followup_key', projectId: input.projectId, audience: 'app_owner' as const, title: 'Review follow-up key', fixHref: FIX_HREFS.followups }
  const s = input.settings
  if (!s) return { ...base, status: 'unknown', summary: 'Mushi could not read the review follow-up settings.' }
  if (!s.enabled && s.offReason) return { ...base, status: 'gap', summary: `Mushi turned review follow-ups off: ${s.offReason} Pick another Cursor key to turn them back on.` }
  if (!s.enabled) return { ...base, status: 'ok', summary: 'Review follow-ups are off (your choice). Your local mushi work lanes can take them.' }
  if (s.keyId && input.keyStatus === null) return { ...base, status: 'gap', summary: 'Review follow-ups are on, but the Cursor key they use was deleted. Follow-ups will not start.' }
  if (s.keyId && input.keyStatus && input.keyStatus !== 'active') {
    return { ...base, status: 'gap', summary: `Review follow-ups are on, but the Cursor key they use is ${input.keyStatus.replace(/_/g, ' ')}. Follow-ups will not start.` }
  }
  return { ...base, status: 'ok', summary: 'Review follow-ups are on and their Cursor key is active.' }
}

// ── Auto-fix dispatch ───────────────────────────────────────────────────────

export interface DispatchInput {
  projectId: string
  /** From buildDispatchers; null when it could not be read. */
  dispatcher: { autofixOn: boolean; server: { agentKeys: number; offKeys: number } } | null
}

export function autofixKeyGap(input: DispatchInput): SetupGap {
  const base = { id: 'autofix_agent_key', projectId: input.projectId, audience: 'app_owner' as const, title: 'Auto-fix agent key', fixHref: FIX_HREFS.cursorKeys }
  const d = input.dispatcher
  if (!d) return { ...base, status: 'unknown', summary: 'Mushi could not read the auto-fix setting and its Cursor keys.' }
  if (!d.autofixOn) return { ...base, status: 'ok', summary: 'Auto-fix is off (your choice).' }
  if (d.server.agentKeys === 0) {
    const off = d.server.offKeys
    return {
      ...base,
      status: 'gap',
      summary: `Auto-fix is on, but no Cursor key can start an agent${off ? ` (${off} key${off === 1 ? ' is' : 's are'} off, used up, or have spend-down off)` : ''}. No fix will start on its own.`,
    }
  }
  return { ...base, status: 'ok', summary: `Auto-fix is on with ${d.server.agentKeys} Cursor key${d.server.agentKeys === 1 ? '' : 's'} that can start agents.` }
}

// ── Deploy events ───────────────────────────────────────────────────────────

/**
 * The 14-day rule: Mushi tells a reporter their fix is live when a deploy
 * event shows the fix commit running. No deploy event for DEPLOY_SILENCE_DAYS
 * means that message is not going out (report 9f64a77b).
 * `lastDeployAt` undefined: the read failed.
 */
export function deployGap(projectId: string, lastDeployAt: string | null | undefined, now: Date): SetupGap {
  const base = { id: 'deploy_events', projectId, audience: 'app_owner' as const, title: 'Deploy events', fixHref: FIX_HREFS.deploys }
  if (lastDeployAt === undefined) return { ...base, status: 'unknown', summary: 'Mushi could not read the deploy events.' }
  if (lastDeployAt === null) {
    return { ...base, status: 'gap', summary: 'Mushi has never seen a deploy of this app, so reporters are not told when their fix goes live.' }
  }
  const days = Math.floor((now.getTime() - Date.parse(lastDeployAt)) / DAY)
  if (days >= DEPLOY_SILENCE_DAYS) {
    return { ...base, status: 'gap', summary: `No deploy seen in ${days} days, so reporters are not told when their fix goes live.` }
  }
  return { ...base, status: 'ok', summary: days === 0 ? 'A deploy was seen today.' : `Last deploy seen ${days} day${days === 1 ? '' : 's'} ago.` }
}

// ── Slack ───────────────────────────────────────────────────────────────────

const SLACK_TOKEN_DEAD = /\b(invalid_auth|token_revoked|token_expired|account_inactive|not_authed)\b/

export interface SlackInput {
  projectId: string
  /** null: the settings could not be read. */
  connected: boolean | null
  /** The latest integration_health_history row of kind 'slack'. */
  latest: { status: string; message: string | null; checked_at: string } | null
}

export function slackGap(input: SlackInput, now: Date): SetupGap {
  const base = { id: 'slack_bot_token', projectId: input.projectId, audience: 'app_owner' as const, title: 'Slack bot token', fixHref: FIX_HREFS.slack }
  if (input.connected === null) return { ...base, status: 'unknown', summary: 'Mushi could not read whether Slack is connected.' }
  if (!input.connected) return { ...base, status: 'ok', summary: 'Slack is not connected (optional).' }
  const row = input.latest
  if (!row || now.getTime() - Date.parse(row.checked_at) > SLACK_PROBE_STALE_MS) {
    return { ...base, status: 'unknown', summary: 'Slack is connected, but Mushi has not checked its token in the last day.' }
  }
  const dead = SLACK_TOKEN_DEAD.exec(row.message ?? '')
  if (row.status === 'down' && dead) {
    return { ...base, status: 'gap', summary: `Slack no longer accepts the bot token (${dead[1]}), so Mushi's Slack messages fail. Reconnect Slack.` }
  }
  if (row.status === 'ok') return { ...base, status: 'ok', summary: 'Slack accepts the bot token.' }
  return { ...base, status: 'unknown', summary: `The last Slack check did not pass: ${(row.message ?? row.status).slice(0, 160)}` }
}

// ── Lists ───────────────────────────────────────────────────────────────────

const STATUS_ORDER: Record<GapStatus, number> = { gap: 0, unknown: 1, ok: 2 }

/** Gaps first, then checks that could not be read, then passes; stable within each. */
export function sortGaps<T extends Pick<SetupGap, 'status'>>(gaps: T[]): T[] {
  return gaps.map((g, i) => ({ g, i })).sort((a, b) => STATUS_ORDER[a.g.status] - STATUS_ORDER[b.g.status] || a.i - b.i).map((x) => x.g)
}

/** Only the lines this audience may see: an app's page never shows platform checks. */
export function forAudience<T extends Pick<SetupGap, 'audience'>>(gaps: T[], audience: GapAudience): T[] {
  return gaps.filter((g) => g.audience === audience)
}

export function countByStatus(gaps: Array<Pick<SetupGap, 'status'>>): Record<GapStatus, number> {
  const out: Record<GapStatus, number> = { ok: 0, gap: 0, unknown: 0 }
  for (const g of gaps) out[g.status]++
  return out
}

// ── Cache ───────────────────────────────────────────────────────────────────

/** A small time-limited map, per isolate. Callers check access before reading it. */
export function createTtlCache<T>(ttlMs: number, max = 500) {
  const entries = new Map<string, { at: number; value: T }>()
  return {
    get(key: string, now: number): { value: T; at: number } | null {
      const e = entries.get(key)
      if (!e) return null
      if (now - e.at >= ttlMs) {
        entries.delete(key)
        return null
      }
      return e
    },
    set(key: string, value: T, now: number): void {
      if (entries.size >= max) entries.delete(entries.keys().next().value as string)
      entries.set(key, { at: now, value })
    },
    clear(): void {
      entries.clear()
    },
  }
}
