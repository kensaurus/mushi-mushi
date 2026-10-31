/**
 * FILE: packages/server/supabase/functions/api/routes/github-connect.ts
 * PURPOSE: Verified "Connect GitHub" for the hosted GitHub App (served by
 *          api-ext). Flow and threat model: _shared/github-connect.ts.
 *
 *   POST /v1/admin/projects/:id/github/connect   → install + authorize links
 *   GET  /v1/webhooks/github/app-authorize       → GitHub's OAuth callback
 *   POST /v1/admin/projects/:id/github/repos     → repositories the grant reaches
 *   POST /v1/admin/projects/:id/github/repo      → save the chosen repository
 *   GET  /v1/admin/projects/:id/github/stack     → the repo's package.json (install snippet)
 *
 * The setup URL (`/v1/webhooks/github/app-installation`, api/routes/public.ts)
 * hands a valid state on to GitHub's authorize page.
 */

import type { Context, Hono } from 'npm:hono@4'
import type { Variables } from '../types.ts'
import { getServiceClient } from '../../_shared/db.ts'
import { jwtAuth } from '../../_shared/auth.ts'
import { logAudit } from '../../_shared/audit.ts'
import { log as rootLog } from '../../_shared/logger.ts'
import { mintInstallationToken, parseGithubRepoUrl, resolveProjectGithubToken } from '../../_shared/github.ts'
import {
  CONNECT_TTL_SECONDS,
  authorizeUrl,
  consoleReturnUrl,
  exchangeCode,
  installUrl,
  listInstallationRepos,
  listUserInstallationRepoIds,
  listUserInstallations,
  MAX_GRANT_REPOS,
  openConnectGrant,
  openConnectState,
  readGithubAppConfig,
  signConnectGrant,
  signConnectState,
  suggestRepo,
  type ConnectReturnPage,
  type GithubAppConfig,
  type InstallationRepo,
} from '../../_shared/github-connect.ts'
import { dbError, jsonError, parseUuidParam, userCanAccessProject } from '../shared.ts'

const log = rootLog.child('github-connect')

type Db = ReturnType<typeof getServiceClient>

export interface GithubConnectDeps {
  /** The app's own GitHub token (install or stored token; never another app's). */
  repoToken?: (db: Db, projectId: string, installationId: number | null) => Promise<string | null>
  now: () => number
  config: () => ReturnType<typeof readGithubAppConfig>
  fetchImpl: (input: string, init?: RequestInit) => Promise<Response>
  mintToken: (installationId: number) => Promise<string>
  kickSweep: (projectId: string) => Promise<void>
}

export const defaultGithubConnectDeps: GithubConnectDeps = {
  now: () => Math.floor(Date.now() / 1000),
  config: () => readGithubAppConfig((name) => Deno.env.get(name)),
  fetchImpl: (input, init) => fetch(input, init),
  mintToken: mintInstallationToken,
  kickSweep: async (projectId) => {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const secret = Deno.env.get('MUSHI_INTERNAL_CALLER_SECRET') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!supabaseUrl || !secret) return
    await fetch(`${supabaseUrl}/functions/v1/webhooks-github-indexer`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'sweep', project_id: projectId }),
      signal: AbortSignal.timeout(5_000),
    }).catch(() => {})
  },
}

const RETURN_PAGES = new Set<ConnectReturnPage>(['onboarding', 'integrations', 'connect'])

/** A signed-in member who may change this app (not a viewer), or the error response. */
async function requireEditor(c: Context<{ Variables: Variables }>, db: Db, projectId: string): Promise<Response | null> {
  const userId = c.get('userId') as string | undefined
  if (!userId) return jsonError(c, 'UNAUTHORIZED', 'Sign in again.', 401)
  const access = await userCanAccessProject(db, userId, projectId)
  if (!access.allowed) return jsonError(c, 'NOT_FOUND', 'This app is not in a team you belong to.', 404)
  if (access.role === 'viewer') return jsonError(c, 'FORBIDDEN', 'Viewers cannot change where this app’s code lives. Ask an owner or admin.', 403)
  return null
}

function notConfigured(c: Context, missing: string[]): Response {
  log.warn('GitHub App connect is not configured', { missing })
  return jsonError(
    c,
    'GITHUB_APP_NOT_CONFIGURED',
    'Connecting through the Mushi GitHub App is not set up on this server. Use a GitHub token instead (Integrations → GitHub → Use a token).',
    409,
  )
}

/** Reads `{ grant }` from the body and checks it belongs to this person and app. */
async function readGrant(
  c: Context<{ Variables: Variables }>,
  cfg: GithubAppConfig,
  projectId: string,
  now: number,
): Promise<{ ok: true; installations: number[]; repoIds: Set<number>; login: string } | { ok: false; res: Response }> {
  const body = (await c.req.json().catch(() => null)) as { grant?: unknown } | null
  const opened = await openConnectGrant(cfg.secret, typeof body?.grant === 'string' ? body.grant : null, now)
  if (!opened.ok) {
    return {
      ok: false,
      res: opened.reason === 'expired'
        ? jsonError(c, 'GRANT_EXPIRED', 'That GitHub sign-in is older than 30 minutes. Press Connect GitHub again.', 410)
        : jsonError(c, 'GRANT_INVALID', 'This GitHub sign-in could not be checked. Press Connect GitHub again.', 400),
    }
  }
  const { grant } = opened
  if (grant.p !== projectId || grant.u !== c.get('userId')) {
    return { ok: false, res: jsonError(c, 'GRANT_MISMATCH', 'This GitHub sign-in was started for another app or person. Press Connect GitHub again here.', 403) }
  }
  return { ok: true, installations: grant.i, repoIds: new Set(grant.r), login: grant.g }
}

const PACKAGE_JSON_MAX_BYTES = 256 * 1024

export function registerGithubConnectRoutes(app: Hono<{ Variables: Variables }>, deps: GithubConnectDeps = defaultGithubConnectDeps): void {
  // The install snippet adapts to the app's stack (framework, bundler env
  // vars). Read-only, members only; any failure is a reason, never an error
  // page, because the snippet works without it.
  app.get('/v1/admin/projects/:id/github/stack', jwtAuth, async (c) => {
    const parsed = parseUuidParam(c, 'id')
    if (!parsed.ok) return parsed.error
    const projectId = parsed.value
    const db = getServiceClient()
    const userId = c.get('userId') as string | undefined
    const access = userId ? await userCanAccessProject(db, userId, projectId) : { allowed: false }
    if (!access.allowed) return jsonError(c, 'NOT_FOUND', 'This app is not in a team you belong to.', 404)
    const { data: repoRow } = await db
      .from('project_repos')
      .select('repo_url, default_branch, github_app_installation_id')
      .eq('project_id', projectId)
      .eq('is_primary', true)
      .maybeSingle()
    const repo = repoRow as { repo_url?: string; default_branch?: string | null; github_app_installation_id?: number | null } | null
    const ref = parseGithubRepoUrl(repo?.repo_url ?? null)
    if (!ref) return c.json({ ok: true, data: { repo: null, packageJson: null, reason: 'no_repo' } })
    const fullName = `${ref.owner}/${ref.repo}`
    const token = await (deps.repoToken ?? ((d, p, i) => resolveProjectGithubToken(d, p, i)))(db, projectId, repo?.github_app_installation_id ?? null)
      .catch(() => null)
    if (!token) return c.json({ ok: true, data: { repo: fullName, packageJson: null, reason: 'no_access' } })
    const branch = repo?.default_branch ? `?ref=${encodeURIComponent(repo.default_branch)}` : ''
    let res: Response
    try {
      res = await deps.fetchImpl(`https://api.github.com/repos/${ref.owner}/${ref.repo}/contents/package.json${branch}`, {
        headers: { Accept: 'application/vnd.github.raw+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' },
        signal: AbortSignal.timeout(8_000),
      })
    } catch {
      return c.json({ ok: true, data: { repo: fullName, packageJson: null, reason: 'github_unreachable' } })
    }
    if (res.status === 404) return c.json({ ok: true, data: { repo: fullName, packageJson: null, reason: 'no_package_json' } })
    if (!res.ok) return c.json({ ok: true, data: { repo: fullName, packageJson: null, reason: 'github_unreachable' } })
    const text = await res.text()
    if (text.length > PACKAGE_JSON_MAX_BYTES) return c.json({ ok: true, data: { repo: fullName, packageJson: null, reason: 'too_large' } })
    return c.json({ ok: true, data: { repo: fullName, packageJson: text, reason: null } })
  })

  app.post('/v1/admin/projects/:id/github/connect', jwtAuth, async (c) => {
    const parsed = parseUuidParam(c, 'id')
    if (!parsed.ok) return parsed.error
    const projectId = parsed.value
    const db = getServiceClient()
    const denied = await requireEditor(c, db, projectId)
    if (denied) return denied
    const cfg = deps.config()
    if (!cfg.ok) return notConfigured(c, cfg.missing)
    const body = (await c.req.json().catch(() => ({}))) as { returnTo?: unknown }
    const r: ConnectReturnPage = RETURN_PAGES.has(body.returnTo as ConnectReturnPage) ? (body.returnTo as ConnectReturnPage) : 'onboarding'
    const exp = deps.now() + CONNECT_TTL_SECONDS
    const state = await signConnectState(cfg.config.secret, { p: projectId, u: c.get('userId') as string, r, exp })
    return c.json({
      ok: true,
      data: {
        installUrl: installUrl(cfg.config, state),
        // Already installed on the account: skip the install page.
        authorizeUrl: authorizeUrl(cfg.config, state),
        expiresAt: new Date(exp * 1000).toISOString(),
      },
    })
  })

  // GitHub's OAuth callback. Always ends on a console page with either a grant
  // (fragment) or a `github_error` the page explains; never on a JSON body.
  app.get('/v1/webhooks/github/app-authorize', async (c) => {
    const cfg = deps.config()
    if (!cfg.ok) {
      log.warn('authorize callback without GitHub App config', { missing: cfg.missing })
      return c.text('GitHub connect is not configured on this server.', 409)
    }
    const config = cfg.config
    const opened = await openConnectState(config.secret, c.req.query('state'), deps.now())
    if (!opened.ok) {
      // No trustworthy project to return to: send the person to setup.
      const u = new URL(`${config.adminBase}/onboarding`)
      u.searchParams.set('github_error', opened.reason === 'expired' ? 'state_expired' : 'state_invalid')
      return c.redirect(u.toString(), 302)
    }
    const { state } = opened
    const back = (extra: { error?: string; grant?: string }) => c.redirect(consoleReturnUrl(config, state.r, state.p, extra), 302)

    const oauthError = c.req.query('error')
    if (oauthError) return back({ error: oauthError === 'access_denied' ? 'authorize_cancelled' : 'authorize_failed' })
    const code = c.req.query('code')
    if (!code) return back({ error: 'authorize_failed' })

    // The person may have left the team between starting and finishing.
    const db = getServiceClient()
    const access = await userCanAccessProject(db, state.u, state.p)
    if (!access.allowed || access.role === 'viewer') return back({ error: 'not_allowed' })

    const exchanged = await exchangeCode(config, code, deps.fetchImpl)
    if (!exchanged.ok) return back({ error: exchanged.reason })
    const listed = await listUserInstallations(config, exchanged.token, deps.fetchImpl)
    if (!listed.ok) return back({ error: listed.reason })
    const usable = listed.installations.filter((i) => !i.suspended)
    if (usable.length === 0) {
      if (listed.installations.length > 0) return back({ error: 'installation_suspended' })
      // Signed in, nothing installed yet: install with the same state. The
      // setup URL brings the browser back here marked `x`, so this happens once.
      if (!state.x) return c.redirect(installUrl(config, c.req.query('state') ?? ''), 302)
      return back({ error: 'no_installation' })
    }
    // The repositories this person can reach, per installation: an org
    // member sees the org's installation, not every repo it covers. GitHub
    // not answering ends the flow; it never widens to the whole installation.
    const repoIds: number[] = []
    try {
      for (const inst of usable) {
        repoIds.push(...(await listUserInstallationRepoIds(inst.id, exchanged.token, deps.fetchImpl)))
        if (repoIds.length >= MAX_GRANT_REPOS) break
      }
    } catch {
      return back({ error: 'github_unreachable' })
    }
    const grant = await signConnectGrant(config.secret, {
      p: state.p,
      u: state.u,
      g: listed.login,
      i: usable.map((i) => i.id),
      r: repoIds.slice(0, MAX_GRANT_REPOS),
      exp: deps.now() + CONNECT_TTL_SECONDS,
    })
    log.info('GitHub connect authorized', { projectId: state.p, installations: usable.length })
    return back({ grant })
  })

  app.post('/v1/admin/projects/:id/github/repos', jwtAuth, async (c) => {
    const parsed = parseUuidParam(c, 'id')
    if (!parsed.ok) return parsed.error
    const projectId = parsed.value
    const db = getServiceClient()
    const denied = await requireEditor(c, db, projectId)
    if (denied) return denied
    const cfg = deps.config()
    if (!cfg.ok) return notConfigured(c, cfg.missing)
    const grant = await readGrant(c, cfg.config, projectId, deps.now())
    if (!grant.ok) return grant.res

    const repos: InstallationRepo[] = []
    const unreachable: number[] = []
    for (const installationId of grant.installations) {
      try {
        const token = await deps.mintToken(installationId)
        // Only the repos this person can reach (the grant), not all the App sees.
        repos.push(...(await listInstallationRepos(installationId, token, deps.fetchImpl)).filter((r) => grant.repoIds.has(r.id)))
      } catch (err) {
        unreachable.push(installationId)
        log.warn('installation repositories unreadable', { installationId, err: err instanceof Error ? err.message : String(err) })
      }
    }
    repos.sort((a, b) => (b.pushedAt ?? '').localeCompare(a.pushedAt ?? ''))
    const [{ data: current }, { data: project }] = await Promise.all([
      db.from('project_repos').select('repo_url').eq('project_id', projectId).eq('is_primary', true).maybeSingle(),
      db.from('projects').select('name').eq('id', projectId).maybeSingle(),
    ])
    // The repo named like the app goes first, so the likely pick is one click.
    const suggested = suggestRepo(repos, (project as { name?: string } | null)?.name)
    if (suggested) repos.sort((a, b) => Number(b.fullName === suggested) - Number(a.fullName === suggested))
    return c.json({
      ok: true,
      data: {
        githubLogin: grant.login,
        repos,
        unreachableInstallations: unreachable,
        // Where to let the App see more repositories (its first installation).
        manageUrl: grant.installations.length > 0
          ? `https://github.com/apps/${cfg.config.slug}/installations/new`
          : null,
        currentRepoUrl: (current as { repo_url?: string } | null)?.repo_url ?? null,
        suggestedFullName: suggested,
      },
    })
  })

  app.post('/v1/admin/projects/:id/github/repo', jwtAuth, async (c) => {
    const parsed = parseUuidParam(c, 'id')
    if (!parsed.ok) return parsed.error
    const projectId = parsed.value
    const db = getServiceClient()
    const denied = await requireEditor(c, db, projectId)
    if (denied) return denied
    const cfg = deps.config()
    if (!cfg.ok) return notConfigured(c, cfg.missing)
    const raw = (await c.req.raw.clone().json().catch(() => null)) as { fullName?: unknown } | null
    const fullName = typeof raw?.fullName === 'string' ? raw.fullName.trim() : ''
    if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(fullName)) {
      return jsonError(c, 'INVALID_REPO', 'Pick a repository from the list.', 400)
    }
    const grant = await readGrant(c, cfg.config, projectId, deps.now())
    if (!grant.ok) return grant.res

    // The repository must be one the verified installations reach right now.
    let chosen: InstallationRepo | null = null
    for (const installationId of grant.installations) {
      try {
        const token = await deps.mintToken(installationId)
        const found = (await listInstallationRepos(installationId, token, deps.fetchImpl)).find(
          (r) => r.fullName.toLowerCase() === fullName.toLowerCase() && grant.repoIds.has(r.id),
        )
        if (found) { chosen = found; break }
      } catch { /* try the next installation */ }
    }
    if (!chosen) {
      return jsonError(c, 'REPO_NOT_REACHABLE', `${fullName} is not one you and the Mushi GitHub App can both reach. Pick it from the list; if it is missing, add it to the App's repositories on GitHub (or ask someone with access to it), then refresh the list.`, 409)
    }

    const repoUrl = `https://github.com/${chosen.fullName}`
    const nowIso = new Date().toISOString()
    // One primary repository per app: the new one replaces the old as primary.
    const { error: demoteErr } = await db
      .from('project_repos')
      .update({ is_primary: false, updated_at: nowIso })
      .eq('project_id', projectId)
      .eq('is_primary', true)
      .neq('repo_url', repoUrl)
    if (demoteErr) return dbError(c, demoteErr)
    const { data: existing } = await db
      .from('project_repos')
      .select('id')
      .eq('project_id', projectId)
      .eq('repo_url', repoUrl)
      .maybeSingle()
    const row = {
      project_id: projectId,
      repo_url: repoUrl,
      role: 'monorepo',
      default_branch: chosen.defaultBranch,
      github_app_installation_id: chosen.installationId,
      is_primary: true,
      indexing_enabled: true,
      updated_at: nowIso,
    }
    const { error: repoErr } = existing
      ? await db.from('project_repos').update(row).eq('id', (existing as { id: string }).id)
      : await db.from('project_repos').insert(row)
    if (repoErr) return dbError(c, repoErr)
    const { error: settingsErr } = await db
      .from('project_settings')
      .upsert(
        {
          project_id: projectId,
          github_repo_url: repoUrl,
          codebase_repo_url: repoUrl,
          codebase_index_enabled: true,
          github_app_installation_id_pending: null,
        } as Record<string, unknown>,
        { onConflict: 'project_id' },
      )
    if (settingsErr) return dbError(c, settingsErr)

    void deps.kickSweep(projectId)
    await logAudit(db, projectId, c.get('userId') as string, 'settings.updated', 'github_repo', projectId, {
      repo_url: repoUrl,
      default_branch: chosen.defaultBranch,
      installation_id: chosen.installationId,
      github_login: grant.login,
    }).catch(() => {})

    return c.json({
      ok: true,
      data: {
        repoUrl,
        fullName: chosen.fullName,
        defaultBranch: chosen.defaultBranch,
        private: chosen.private,
      },
    })
  })
}
