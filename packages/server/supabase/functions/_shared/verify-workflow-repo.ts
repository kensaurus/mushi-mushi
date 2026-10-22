/**
 * FILE: packages/server/supabase/functions/_shared/verify-workflow-repo.ts
 * PURPOSE: What the Mushi verify workflow needs to know about a repo before
 *          Mushi fills it in (verify-workflow.ts detectRepoToolchain): the
 *          root file names (lockfiles, .yarnrc.yml) and whether a local
 *          `.github/actions/setup/action.yml` exists, read from GitHub (two
 *          Contents calls), plus the workflow files from the project's
 *          current GitHub connector snapshot (no extra GitHub call).
 *
 * Best effort: any failure answers the default toolchain (the template as it
 * is), never an error, so copying the workflow keeps working.
 */

import { fetchWithTimeout } from './http.ts'
import type { GithubRepoRef } from './github.ts'
import { DEFAULT_TOOLCHAIN, detectRepoToolchain, LOCAL_SETUP_ACTION_PATH, type RepoToolchain } from './verify-workflow.ts'

// deno-lint-ignore no-explicit-any
type Db = { from: (table: string) => any }
type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

function headers(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'mushi-mushi-verify' }
}

function api(ref: GithubRepoRef, tail: string): string {
  return `https://api.github.com/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}${tail}`
}

/** Workflow files from the project's current GitHub snapshot for this repo. */
export async function snapshotWorkflows(db: Db, projectId: string, repoFullName: string): Promise<Array<{ path: string; text: string }>> {
  const { data, error } = await db
    .from('connector_snapshots')
    .select('snapshot')
    .eq('project_id', projectId)
    .eq('kind', 'github')
    .eq('is_current', true)
    .eq('ok', true)
  if (error) return []
  for (const row of (data ?? []) as Array<{ snapshot: { facts?: { workflowFiles?: Record<string, unknown> }; resources?: Array<{ kind?: string; externalId?: string }> } | null }>) {
    const repo = row.snapshot?.resources?.find((r) => r.kind === 'repo')?.externalId
    if (!repo || repo.toLowerCase() !== repoFullName.toLowerCase()) continue
    return Object.entries(row.snapshot?.facts?.workflowFiles ?? {})
      .filter((e): e is [string, string] => typeof e[1] === 'string')
      .map(([path, text]) => ({ path, text }))
  }
  return []
}

export async function readRepoToolchain(
  db: Db,
  input: { projectId: string; token: string; ref: GithubRepoRef; branch: string | null; fetchImpl?: FetchLike },
): Promise<RepoToolchain> {
  const doFetch: FetchLike = input.fetchImpl ?? ((u, init) => fetchWithTimeout(u, init ?? {}))
  const q = input.branch ? `?ref=${encodeURIComponent(input.branch)}` : ''
  try {
    const [root, setup, workflows] = await Promise.all([
      doFetch(api(input.ref, `/contents/${q}`), { headers: headers(input.token) }),
      doFetch(api(input.ref, `/contents/${LOCAL_SETUP_ACTION_PATH.split('/').map(encodeURIComponent).join('/')}${q}`), { headers: headers(input.token) }),
      snapshotWorkflows(db, input.projectId, `${input.ref.owner}/${input.ref.repo}`),
    ])
    const listing = root.ok ? ((await root.json().catch(() => null)) as Array<{ name?: string; type?: string }> | null) : null
    if (!Array.isArray(listing)) return { ...DEFAULT_TOOLCHAIN, ...detectRepoToolchain({ rootFiles: [], hasLocalSetupAction: false, workflows }), packageManager: null }
    const body = setup.ok ? ((await setup.json().catch(() => null)) as { type?: string } | null) : null
    return detectRepoToolchain({
      rootFiles: listing.filter((f) => f.type === 'file' && typeof f.name === 'string').map((f) => f.name as string),
      hasLocalSetupAction: body?.type === 'file',
      workflows,
    })
  } catch {
    return DEFAULT_TOOLCHAIN
  }
}
