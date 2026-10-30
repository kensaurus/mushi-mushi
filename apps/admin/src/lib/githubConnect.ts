/**
 * FILE: apps/admin/src/lib/githubConnect.ts
 * PURPOSE: Client side of the verified "Connect GitHub" flow
 *          (server: api/routes/github-connect.ts).
 *
 * GitHub sends the person back with a short-lived grant in the URL fragment
 * (`#gh_grant=…`). It is read once, kept in sessionStorage for this tab and
 * this app (so a reload does not lose it), and removed from the address bar.
 */

import { apiFetch } from './supabase'

export type GithubConnectReturn = 'onboarding' | 'integrations' | 'connect'

export interface ConnectLinks {
  installUrl: string
  authorizeUrl: string
  expiresAt: string
}

interface PickableRepo {
  fullName: string
  private: boolean
  defaultBranch: string
  installationId: number
  pushedAt: string | null
}

export interface RepoList {
  githubLogin: string
  repos: PickableRepo[]
  unreachableInstallations: number[]
  manageUrl: string | null
  currentRepoUrl: string | null
}

export interface SavedRepo {
  repoUrl: string
  fullName: string
  defaultBranch: string
  private: boolean
}

/** What each `github_error` (callback) or error code (API) means, and what to do. */
const MESSAGES: Record<string, string> = {
  authorize_cancelled: 'GitHub sign-in was cancelled, so nothing was connected. Press Connect GitHub to try again.',
  authorize_failed: 'GitHub did not confirm the sign-in. Press Connect GitHub to try again.',
  code_expired: 'The GitHub sign-in took too long and expired. Press Connect GitHub again.',
  github_unreachable: 'GitHub did not answer. Try again in a minute.',
  state_expired: 'That GitHub link was older than 30 minutes. Press Connect GitHub again.',
  state_invalid: 'That GitHub link could not be checked. Start again from Connect GitHub on this page.',
  install_unverified: 'Mushi only connects repositories after you sign in to GitHub from this page. Press Connect GitHub to finish.',
  no_installation: 'Your GitHub account has not installed the Mushi GitHub App yet. Press Connect GitHub and choose Install.',
  installation_suspended: 'The Mushi GitHub App is suspended on your GitHub account. Unsuspend it in GitHub → Settings → Applications, then connect again.',
  not_allowed: 'You can no longer change this app (your role changed). Ask an owner or admin to connect GitHub.',
  missing_installation_id: 'GitHub did not say which installation was used. Press Connect GitHub again.',
  link_failed: 'The connection could not be saved. Try again in a minute.',
  GRANT_EXPIRED: 'That GitHub sign-in is older than 30 minutes. Press Connect GitHub again.',
  GRANT_INVALID: 'This GitHub sign-in could not be checked. Press Connect GitHub again.',
  GRANT_MISMATCH: 'This GitHub sign-in was started for another app or person. Press Connect GitHub here.',
  REPO_NOT_REACHABLE: 'The Mushi GitHub App cannot see that repository. Add it to the App’s repositories on GitHub, then refresh the list.',
  GITHUB_APP_NOT_CONFIGURED: 'Connecting through the GitHub App is not set up on this server. Use a GitHub token instead.',
}

export function githubConnectMessage(code: string | null | undefined, fallback?: string): string {
  if (code && MESSAGES[code]) return MESSAGES[code]
  return fallback ?? 'Connecting GitHub did not finish. Press Connect GitHub to try again.'
}

const grantKey = (projectId: string) => `mushi:github-grant:${projectId}`

/**
 * Takes a grant from the fragment (and clears it from the address bar), or
 * the one this tab already stored for the app.
 */
export function takeGithubGrant(projectId: string, loc: Pick<Location, 'hash' | 'pathname' | 'search'> = window.location): string | null {
  const match = /(?:^#|&)gh_grant=([^&]+)/.exec(loc.hash)
  if (match) {
    const grant = decodeURIComponent(match[1])
    try { sessionStorage.setItem(grantKey(projectId), grant) } catch { /* private mode: the fragment still works once */ }
    try { window.history.replaceState(window.history.state, '', `${loc.pathname}${loc.search}`) } catch { /* not in a browser */ }
    return grant
  }
  try { return sessionStorage.getItem(grantKey(projectId)) } catch { return null }
}

/** True while the person is coming back from GitHub for this app (grant or error). */
export function isReturningFromGithub(projectId: string, loc: Pick<Location, 'hash' | 'search'> = window.location): boolean {
  if (/(?:^#|&)gh_grant=/.test(loc.hash) || new URLSearchParams(loc.search).has('github_error')) return true
  try { return sessionStorage.getItem(grantKey(projectId)) !== null } catch { return false }
}

export function forgetGithubGrant(projectId: string): void {
  try { sessionStorage.removeItem(grantKey(projectId)) } catch { /* nothing stored */ }
}

export function requestConnectLinks(projectId: string, returnTo: GithubConnectReturn) {
  return apiFetch<ConnectLinks>(`/v1/admin/projects/${projectId}/github/connect`, {
    method: 'POST',
    body: JSON.stringify({ returnTo }),
    cache: 'no-store',
  })
}

export function listPickableRepos(projectId: string, grant: string) {
  return apiFetch<RepoList>(`/v1/admin/projects/${projectId}/github/repos`, {
    method: 'POST',
    body: JSON.stringify({ grant }),
    cache: 'no-store',
  })
}

export function saveRepo(projectId: string, grant: string, fullName: string) {
  return apiFetch<SavedRepo>(`/v1/admin/projects/${projectId}/github/repo`, {
    method: 'POST',
    body: JSON.stringify({ grant, fullName }),
    cache: 'no-store',
  })
}

/** "owner/repo" from a stored repo URL, or null. */
export function repoFullName(url: string | null | undefined): string | null {
  const m = url ? /github\.com[/:]([^/]+)\/([^/#?]+?)(?:\.git)?\/?$/i.exec(url.trim()) : null
  return m ? `${m[1]}/${m[2]}` : null
}
