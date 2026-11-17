/**
 * FILE: apps/admin/src/lib/githubAccess.ts
 * PURPOSE: One GitHub status for an app, used by every surface on
 *          Integrations (the top tile, "Your code on GitHub", Codebase
 *          indexing) and the report page's "Turn on". Read from the
 *          dispatch preflight: `repoUrl` (a repo is linked) and its `github`
 *          check (a repo AND a GitHub App install or token to reach it).
 *
 *          Owner, 2026-11-17: the tile said "Not connected" while the card
 *          said "Connected: kensaurus/kensaur.us", and Codebase indexing
 *          showed the raw `no_token: neither github_app_installation_id …`.
 *          The tile read only the token form; an App install never counted.
 */

import type { PreflightState } from './useDispatchPreflight'
import { repoFullName } from './githubConnect'

export type GithubAccessState = 'not_connected' | 'repo_no_access' | 'connected'

export interface GithubAccess {
  state: GithubAccessState
  /** owner/name of the linked repo, when one is linked. */
  repo: string | null
}

/** The status, or null while the preflight is loading or could not be read. */
export function githubAccessFromPreflight(p: Pick<PreflightState, 'loading' | 'error' | 'checks' | 'repoUrl'>): GithubAccess | null {
  if (p.loading || p.error) return null
  const check = p.checks.find((c) => c.key === 'github')
  if (!check) return null
  const repo = repoFullName(p.repoUrl) ?? p.repoUrl ?? null
  if (check.ready) return { state: 'connected', repo }
  return { state: repo ? 'repo_no_access' : 'not_connected', repo }
}

/** The short status words, same everywhere. */
export const GITHUB_ACCESS_LABEL: Record<GithubAccessState, string> = {
  not_connected: 'Not connected',
  repo_no_access: 'Repo linked · app access missing',
  connected: 'Connected',
}

/** One sentence for "Repo linked · app access missing". */
export function githubAccessMissingSentence(repo: string | null): string {
  const name = repo ?? 'this repo'
  return `Mushi Mushi can't read this repo yet: give the Mushi Mushi GitHub App access to ${name}.`
}

/**
 * A codebase-index error in plain English. `code` is the raw text, kept for a
 * tooltip or support. Unknown errors keep their own text, prefixed so they
 * read as what GitHub or the sweep said.
 */
export function plainIndexError(raw: string, repo: string | null): { text: string; code: string } {
  const msg = raw.trim()
  if (/^no_token\b/i.test(msg) || /bad credentials|requires authentication/i.test(msg) || /\b401\b/.test(msg)) {
    return { text: githubAccessMissingSentence(repo), code: msg }
  }
  if (/resource not accessible|\b403\b/i.test(msg)) {
    return { text: `The Mushi Mushi GitHub App can see ${repo ?? 'the repo'} but lacks a permission it needs. Open the App's settings on GitHub and accept its requested permissions.`, code: msg }
  }
  if (/\b404\b|not found/i.test(msg)) {
    return { text: `GitHub could not find ${repo ?? 'the repo'}, or the Mushi Mushi GitHub App cannot see it. Check the repo name, then give the App access to it.`, code: msg }
  }
  if (/^filter_matches_nothing:/.test(msg)) {
    return { text: 'The path filter matches no file in the repo. Change or clear the path filter.', code: msg }
  }
  return { text: `The last sweep stopped: ${msg}`, code: msg }
}
