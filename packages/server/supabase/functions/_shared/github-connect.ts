/**
 * FILE: packages/server/supabase/functions/_shared/github-connect.ts
 * PURPOSE: Verified "Connect GitHub" for the hosted Mushi GitHub App.
 *
 * The App's setup URL receives `installation_id` and `state` as plain query
 * parameters, so anyone can send a spoofed id (GitHub: "you should not rely on
 * the validity of the installation_id parameter … generate a user access
 * token … and then check that the installation is associated with that
 * user"). The flow:
 *
 *   1. The console asks for a connect link (signed-in member, non-viewer).
 *      `state` = HMAC-signed { project, user, return page, expiry }.
 *   2. GitHub installs the App and sends the browser to the setup URL; with a
 *      valid state it goes on to GitHub's authorize page (same state data).
 *   3. The authorize callback exchanges `code` for a user token and lists the
 *      installations of this App that user can reach (`GET /user/installations`).
 *   4. The console gets a signed short-lived grant { project, user,
 *      installation ids } in the URL fragment, lists those installations'
 *      repositories, and saves the one the person picks.
 *
 * Nothing here is stored: the grant is the proof, it expires in 30 minutes
 * and only the person who started the flow can use it for that project.
 */

export const CONNECT_TTL_SECONDS = 30 * 60

export type ConnectReturnPage = 'onboarding' | 'integrations' | 'connect'

export interface ConnectState {
  /** project id */
  p: string
  /** console user id */
  u: string
  /** console page to return to */
  r: ConnectReturnPage
  /** expiry, unix seconds */
  exp: number
}

export interface ConnectGrant {
  p: string
  u: string
  /** installation ids the person can reach */
  i: number[]
  /** GitHub login that authorized */
  g: string
  exp: number
}

const RETURN_PAGES = new Set<ConnectReturnPage>(['onboarding', 'integrations', 'connect'])
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const enc = new TextEncoder()

function b64url(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromB64url(s: string): Uint8Array | null {
  try {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'))
    return Uint8Array.from(bin, (c) => c.charCodeAt(0))
  } catch {
    return null
  }
}

async function hmac(secret: string, purpose: string, body: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(`mushi-github-connect:${purpose}:${secret}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(body)))
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

async function sign(secret: string, purpose: string, payload: object): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify(payload)))
  return `${body}.${b64url(await hmac(secret, purpose, body))}`
}

async function open(secret: string, purpose: string, token: string | null | undefined): Promise<Record<string, unknown> | null> {
  if (!token || token.length > 4096) return null
  const [body, mac, extra] = token.split('.')
  if (!body || !mac || extra !== undefined) return null
  const given = fromB64url(mac)
  if (!given || !sameBytes(given, await hmac(secret, purpose, body))) return null
  const raw = fromB64url(body)
  if (!raw) return null
  try {
    const parsed = JSON.parse(new TextDecoder().decode(raw))
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export function signConnectState(secret: string, state: ConnectState): Promise<string> {
  return sign(secret, 'state', state)
}

/** The state, or why it is unusable. Expired is told apart so the page can say "start again". */
export async function openConnectState(
  secret: string,
  token: string | null | undefined,
  nowSeconds: number,
): Promise<{ ok: true; state: ConnectState } | { ok: false; reason: 'invalid' | 'expired' }> {
  const v = await open(secret, 'state', token)
  if (
    !v || typeof v.p !== 'string' || !UUID_RE.test(v.p) || typeof v.u !== 'string' || !UUID_RE.test(v.u) ||
    typeof v.r !== 'string' || !RETURN_PAGES.has(v.r as ConnectReturnPage) || typeof v.exp !== 'number'
  ) return { ok: false, reason: 'invalid' }
  if (v.exp < nowSeconds) return { ok: false, reason: 'expired' }
  return { ok: true, state: { p: v.p, u: v.u, r: v.r as ConnectReturnPage, exp: v.exp } }
}

export function signConnectGrant(secret: string, grant: ConnectGrant): Promise<string> {
  return sign(secret, 'grant', grant)
}

export async function openConnectGrant(
  secret: string,
  token: string | null | undefined,
  nowSeconds: number,
): Promise<{ ok: true; grant: ConnectGrant } | { ok: false; reason: 'invalid' | 'expired' }> {
  const v = await open(secret, 'grant', token)
  if (
    !v || typeof v.p !== 'string' || typeof v.u !== 'string' || typeof v.g !== 'string' ||
    !Array.isArray(v.i) || !v.i.every((n) => Number.isSafeInteger(n) && (n as number) > 0) ||
    v.i.length > 50 || typeof v.exp !== 'number'
  ) return { ok: false, reason: 'invalid' }
  if (v.exp < nowSeconds) return { ok: false, reason: 'expired' }
  return { ok: true, grant: { p: v.p, u: v.u, g: v.g, i: v.i as number[], exp: v.exp } }
}

export interface GithubAppConfig {
  slug: string
  appId: string | null
  clientId: string
  clientSecret: string
  /** The authorize callback; must be one of the App's callback URLs. */
  redirectUri: string
  /** HMAC key for state and grants. */
  secret: string
  /** Console base, e.g. https://kensaur.us/mushi-mushi/admin */
  adminBase: string
}

/** The App settings this flow needs, or the names that are missing. */
export function readGithubAppConfig(get: (name: string) => string | undefined): { ok: true; config: GithubAppConfig } | { ok: false; missing: string[] } {
  const slug = get('GITHUB_APP_SLUG')?.trim()
  const clientId = get('GITHUB_APP_CLIENT_ID')?.trim()
  const clientSecret = get('GITHUB_APP_CLIENT_SECRET')?.trim()
  const supabaseUrl = get('SUPABASE_URL')?.trim().replace(/\/$/, '')
  const secret = get('MUSHI_GITHUB_CONNECT_SECRET')?.trim() || get('SUPABASE_SERVICE_ROLE_KEY')?.trim()
  const adminBase = get('ADMIN_BASE_URL')?.trim().replace(/\/$/, '')
  const redirectUri =
    get('GITHUB_APP_OAUTH_REDIRECT_URL')?.trim() ||
    (supabaseUrl ? `${supabaseUrl}/functions/v1/api/v1/webhooks/github/app-authorize` : '')
  const missing = [
    !slug && 'GITHUB_APP_SLUG',
    !clientId && 'GITHUB_APP_CLIENT_ID',
    !clientSecret && 'GITHUB_APP_CLIENT_SECRET',
    !secret && 'MUSHI_GITHUB_CONNECT_SECRET',
    !adminBase && 'ADMIN_BASE_URL',
    !redirectUri && 'SUPABASE_URL',
  ].filter((m): m is string => Boolean(m))
  if (missing.length) return { ok: false, missing }
  return {
    ok: true,
    config: {
      slug: slug!, appId: get('GITHUB_APP_ID')?.trim() || null, clientId: clientId!, clientSecret: clientSecret!,
      redirectUri, secret: secret!, adminBase: adminBase!,
    },
  }
}

export function installUrl(cfg: GithubAppConfig, state: string): string {
  return `https://github.com/apps/${encodeURIComponent(cfg.slug)}/installations/new?state=${encodeURIComponent(state)}`
}

export function authorizeUrl(cfg: GithubAppConfig, state: string): string {
  const u = new URL('https://github.com/login/oauth/authorize')
  u.searchParams.set('client_id', cfg.clientId)
  u.searchParams.set('redirect_uri', cfg.redirectUri)
  u.searchParams.set('state', state)
  u.searchParams.set('allow_signup', 'false')
  return u.toString()
}

/** Where the console shows the result: the page the person started from. */
export function consoleReturnUrl(cfg: GithubAppConfig, page: ConnectReturnPage, projectId: string, extra: { error?: string; grant?: string } = {}): string {
  const path = page === 'integrations' ? 'integrations/config' : page
  const u = new URL(`${cfg.adminBase}/${path}`)
  u.searchParams.set('project', projectId)
  if (extra.error) u.searchParams.set('github_error', extra.error)
  // The grant rides in the fragment: browsers never send it to a server, so
  // it stays out of access logs and Referer headers.
  return extra.grant ? `${u.toString()}#gh_grant=${encodeURIComponent(extra.grant)}` : u.toString()
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

/** `code` → user access token, or a plain reason. */
export async function exchangeCode(
  cfg: GithubAppConfig,
  code: string,
  fetchImpl: FetchLike = fetch,
): Promise<{ ok: true; token: string } | { ok: false; reason: string }> {
  let res: Response
  try {
    res = await fetchImpl('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: cfg.clientId, client_secret: cfg.clientSecret, code, redirect_uri: cfg.redirectUri }),
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    return { ok: false, reason: 'github_unreachable' }
  }
  const body = (await res.json().catch(() => null)) as { access_token?: string; error?: string } | null
  if (!res.ok || !body) return { ok: false, reason: 'github_unreachable' }
  if (body.access_token) return { ok: true, token: body.access_token }
  return { ok: false, reason: body.error === 'bad_verification_code' ? 'code_expired' : 'authorize_failed' }
}

export interface UserInstallation {
  id: number
  account: string
  accountType: 'User' | 'Organization' | string
  repositorySelection: 'all' | 'selected' | string
  suspended: boolean
}

/** This App's installations the user can reach (≤ 5 pages of 100). */
export async function listUserInstallations(
  cfg: GithubAppConfig,
  userToken: string,
  fetchImpl: FetchLike = fetch,
): Promise<{ ok: true; login: string; installations: UserInstallation[] } | { ok: false; reason: string }> {
  const headers = { Accept: 'application/vnd.github+json', Authorization: `Bearer ${userToken}`, 'X-GitHub-Api-Version': '2022-11-28' }
  let login = ''
  try {
    const me = await fetchImpl('https://api.github.com/user', { headers, signal: AbortSignal.timeout(10_000) })
    if (me.ok) login = String(((await me.json()) as { login?: string }).login ?? '')
  } catch { /* login is only shown back to the person */ }
  const out: UserInstallation[] = []
  for (let page = 1; page <= 5; page++) {
    let res: Response
    try {
      res = await fetchImpl(`https://api.github.com/user/installations?per_page=100&page=${page}`, { headers, signal: AbortSignal.timeout(10_000) })
    } catch {
      return { ok: false, reason: 'github_unreachable' }
    }
    if (!res.ok) return { ok: false, reason: res.status === 401 ? 'authorize_failed' : 'github_unreachable' }
    const body = (await res.json()) as { installations?: Array<Record<string, unknown>> }
    const rows = body.installations ?? []
    for (const row of rows) {
      const ours = String(row.app_slug ?? '') === cfg.slug || (cfg.appId !== null && String(row.app_id ?? '') === cfg.appId)
      if (!ours) continue
      const account = (row.account ?? {}) as { login?: string; type?: string }
      out.push({
        id: Number(row.id),
        account: String(account.login ?? ''),
        accountType: String(account.type ?? 'User'),
        repositorySelection: String(row.repository_selection ?? 'selected'),
        suspended: row.suspended_at != null,
      })
    }
    if (rows.length < 100) break
  }
  return { ok: true, login, installations: out }
}

/** GitHub's page where the account picks which repositories the App sees. */
export function installationSettingsUrl(inst: Pick<UserInstallation, 'id' | 'account' | 'accountType'>): string {
  return inst.accountType === 'Organization'
    ? `https://github.com/organizations/${encodeURIComponent(inst.account)}/settings/installations/${inst.id}`
    : `https://github.com/settings/installations/${inst.id}`
}

export interface InstallationRepo {
  fullName: string
  private: boolean
  defaultBranch: string
  installationId: number
  pushedAt: string | null
}

/** Repositories one installation can reach (≤ 3 pages of 100), with an installation token. */
export async function listInstallationRepos(
  installationId: number,
  installationToken: string,
  fetchImpl: FetchLike = fetch,
): Promise<InstallationRepo[]> {
  const headers = { Accept: 'application/vnd.github+json', Authorization: `Bearer ${installationToken}`, 'X-GitHub-Api-Version': '2022-11-28' }
  const out: InstallationRepo[] = []
  for (let page = 1; page <= 3; page++) {
    const res = await fetchImpl(`https://api.github.com/installation/repositories?per_page=100&page=${page}`, { headers, signal: AbortSignal.timeout(10_000) })
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`)
    const body = (await res.json()) as { repositories?: Array<Record<string, unknown>> }
    const rows = body.repositories ?? []
    for (const r of rows) {
      out.push({
        fullName: String(r.full_name ?? ''),
        private: r.private === true,
        defaultBranch: String(r.default_branch ?? 'main'),
        installationId,
        pushedAt: typeof r.pushed_at === 'string' ? r.pushed_at : null,
      })
    }
    if (rows.length < 100) break
  }
  return out.filter((r) => r.fullName.includes('/'))
}
