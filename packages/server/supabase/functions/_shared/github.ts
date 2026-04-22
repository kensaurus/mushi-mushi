/**
 * FILE: packages/server/supabase/functions/_shared/github.ts
 * PURPOSE: GitHub auth helpers shared between `webhooks-github-indexer`,
 *          `fix-worker`, and `ci-sync`. Keeps one implementation of the JWT
 *          → installation-token dance and the PAT-fallback so a token format
 *          fix lands once and flows everywhere.
 *
 * Why not Octokit: Deno edge bundles ship 40kB of plain code; Octokit weighs
 * ~350kB transitively and pulls Node polyfills that don't run in the edge
 * runtime. The JWT is trivial to mint by hand with Web Crypto + RSA-PKCS1-v1_5.
 */

import type { getServiceClient } from './db.ts'

async function importPkcs8(pem: string): Promise<CryptoKey> {
  const stripped = pem
    .replace(/-----BEGIN [A-Z ]+-----/, '')
    .replace(/-----END [A-Z ]+-----/, '')
    .replace(/\s+/g, '')
  const der = Uint8Array.from(atob(stripped), (c) => c.charCodeAt(0))
  return await crypto.subtle.importKey(
    'pkcs8',
    der,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )
}

/**
 * Mint a short-lived installation access token for the given GitHub App
 * installation. Tokens are valid for ~60 min per GitHub's contract; we
 * never cache them because each edge invocation is cheap and re-minting
 * is the simplest way to avoid "token expired mid-run" flakes.
 *
 * @throws if GITHUB_APP_ID or GITHUB_APP_PRIVATE_KEY are unset, or if
 *         GitHub returns non-2xx (caller should fall back to PAT).
 */
export async function mintInstallationToken(installationId: number): Promise<string> {
  const appId = Deno.env.get('GITHUB_APP_ID')
  const pem = Deno.env.get('GITHUB_APP_PRIVATE_KEY')
  if (!appId || !pem) throw new Error('GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY required')

  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'RS256', typ: 'JWT' }
  const payload = { iat: now - 30, exp: now + 540, iss: appId }
  const enc = (obj: unknown) =>
    btoa(JSON.stringify(obj)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
  const data = `${enc(header)}.${enc(payload)}`

  const key = await importPkcs8(pem)
  const sig = await crypto.subtle.sign({ name: 'RSASSA-PKCS1-v1_5' }, key, new TextEncoder().encode(data))
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
  const jwt = `${data}.${sigB64}`

  const res = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    },
  )
  if (!res.ok) throw new Error(`installation token mint failed: ${res.status}`)
  const body = await res.json() as { token: string }
  return body.token
}

/**
 * Resolve a GitHub token for a project, preferring the App installation if
 * the caller provides one. Order:
 *   1. `installationId` (when present, try App mint; on failure fall through)
 *   2. `project_settings.github_installation_token_ref` — PAT stored in vault
 *   3. `GITHUB_TOKEN` env fallback (self-host / founder dogfood)
 *
 * Returns null when nothing resolves — callers should surface a "connect
 * GitHub" error rather than proceed with an unauthenticated request.
 */
export async function resolveProjectGithubToken(
  db: ReturnType<typeof getServiceClient>,
  projectId: string,
  installationId: number | null = null,
): Promise<string | null> {
  if (installationId && installationId > 0) {
    try {
      return await mintInstallationToken(installationId)
    } catch {
      // Fall through to PAT; a failed mint is not necessarily fatal if the
      // project has a PAT stored as a belt-and-braces fallback.
    }
  }

  const { data, error } = await db
    .from('project_settings')
    .select('github_installation_token_ref')
    .eq('project_id', projectId)
    .maybeSingle()

  if (!error && data?.github_installation_token_ref) {
    const ref = String(data.github_installation_token_ref)
    if (ref.startsWith('vault://')) {
      const id = ref.slice('vault://'.length)
      const { data: secret, error: vaultErr } = await db.rpc('vault_get_secret', { secret_id: id })
      if (!vaultErr && typeof secret === 'string' && secret.length > 0) {
        return secret
      }
    } else if (ref.length > 0) {
      return ref
    }
  }
  return Deno.env.get('GITHUB_TOKEN') ?? null
}

export interface GithubRepoRef {
  owner: string
  repo: string
}

const GITHUB_URL_RE = /^https?:\/\/(?:www\.)?github\.com\/([^\/\s]+)\/([^\/\s#?]+?)(?:\.git)?\/?$/i

export function parseGithubRepoUrl(url: string | null | undefined): GithubRepoRef | null {
  if (!url) return null
  const match = GITHUB_URL_RE.exec(url.trim())
  if (!match) return null
  return { owner: match[1], repo: match[2] }
}

export interface CheckRunSnapshot {
  status: string | null
  conclusion: string | null
}

/**
 * Pull the latest check-run conclusion for a commit. GitHub returns the full
 * list; we collapse to a single { status, conclusion } using the same rules
 * the UI uses:
 *   - If any check-run is still `queued` or `in_progress` → status stays
 *     pending and conclusion stays null (the PR is not done).
 *   - Otherwise conclusion = worst (failure > cancelled > timed_out > neutral
 *     > skipped > success), mirroring GitHub's own UI badge colouring.
 */
export async function fetchLatestCheckRun(
  token: string,
  ref: GithubRepoRef,
  commitSha: string,
): Promise<CheckRunSnapshot | null> {
  const res = await fetch(
    `https://api.github.com/repos/${ref.owner}/${ref.repo}/commits/${commitSha}/check-runs?per_page=100`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    },
  )
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`check-runs fetch ${res.status}`)
  const body = await res.json() as {
    check_runs?: Array<{ status: string | null; conclusion: string | null }>
  }
  const runs = body.check_runs ?? []
  if (runs.length === 0) return { status: null, conclusion: null }

  const pending = runs.some((r) => r.status === 'queued' || r.status === 'in_progress')
  if (pending) {
    return { status: 'in_progress', conclusion: null }
  }

  // Worst-wins ordering. We take whatever the matrix says is the most
  // severe conclusion, so a red "failure" never gets hidden by a later
  // green "success" from an unrelated check.
  const severity: Record<string, number> = {
    failure: 100,
    cancelled: 90,
    timed_out: 80,
    action_required: 70,
    stale: 60,
    neutral: 40,
    skipped: 30,
    success: 10,
  }
  let worst: string | null = null
  let worstScore = -1
  for (const r of runs) {
    if (!r.conclusion) continue
    const score = severity[r.conclusion] ?? 50
    if (score > worstScore) {
      worstScore = score
      worst = r.conclusion
    }
  }
  return { status: 'completed', conclusion: worst }
}
