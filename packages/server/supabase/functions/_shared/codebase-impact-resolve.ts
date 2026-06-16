/**
 * Resolve changed file paths for diff-impact analysis from manual paths,
 * last push, GitHub compare, or fix PR files.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { ghFetch } from './github-pr.ts'
import { parseGithubRepoUrl, resolveProjectGithubToken } from './github.ts'

export type ImpactSource = 'paths' | 'last_push' | 'compare' | 'fix'

export interface ResolvedImpactPaths {
  changed_paths: string[]
  source: ImpactSource
  meta?: Record<string, string | null>
}

function ghHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
}

async function fetchCompareFiles(
  token: string,
  owner: string,
  repo: string,
  base: string,
  head: string,
): Promise<string[]> {
  const url = `https://api.github.com/repos/${owner}/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`
  const data = (await ghFetch(url, { headers: ghHeaders(token) })) as {
    files?: Array<{ filename?: string; status?: string }>
  }
  return (data.files ?? [])
    .filter((f) => f.filename && f.status !== 'removed')
    .map((f) => f.filename!)
}

async function fetchCommitParent(
  token: string,
  owner: string,
  repo: string,
  sha: string,
): Promise<string | null> {
  const url = `https://api.github.com/repos/${owner}/${repo}/commits/${encodeURIComponent(sha)}`
  const data = (await ghFetch(url, { headers: ghHeaders(token) })) as {
    parents?: Array<{ sha?: string }>
  }
  return data.parents?.[0]?.sha ?? null
}

export async function resolveImpactChangedPaths(
  db: SupabaseClient,
  projectId: string,
  opts: {
    pathsParam?: string
    ref?: string
    compare?: string
    fixId?: string
  },
): Promise<{ ok: true; data: ResolvedImpactPaths } | { ok: false; code: string; message: string }> {
  const manual = (opts.pathsParam ?? '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
  if (manual.length > 0) {
    return { ok: true, data: { changed_paths: manual, source: 'paths' } }
  }

  if (opts.fixId) {
    const { data: fix } = await db
      .from('fix_attempts')
      .select('id, project_id, files_changed, status')
      .eq('id', opts.fixId)
      .eq('project_id', projectId)
      .maybeSingle()
    if (!fix) {
      return { ok: false, code: 'NOT_FOUND', message: 'Fix attempt not found for this project' }
    }
    const paths = (fix.files_changed ?? []).filter(Boolean)
    if (paths.length === 0) {
      return { ok: false, code: 'NO_PATHS', message: 'Fix attempt has no recorded file changes' }
    }
    return { ok: true, data: { changed_paths: paths, source: 'fix', meta: { fix_id: fix.id } } }
  }

  const { data: repoRow } = await db
    .from('project_repos')
    .select('repo_url, commit_sha, default_branch')
    .eq('project_id', projectId)
    .eq('is_primary', true)
    .maybeSingle()

  if (!repoRow?.repo_url) {
    return { ok: false, code: 'NO_REPO', message: 'No connected GitHub repo for this project' }
  }

  const parsed = parseGithubRepoUrl(repoRow.repo_url)
  if (!parsed) {
    return { ok: false, code: 'BAD_REPO', message: 'Could not parse GitHub repo URL' }
  }

  const token = await resolveProjectGithubToken(db, projectId)
  if (!token) {
    return { ok: false, code: 'NO_GITHUB', message: 'GitHub not connected — connect in Connect & Update' }
  }

  const headSha = repoRow.commit_sha as string | null
  if (!headSha) {
    return { ok: false, code: 'NO_SHA', message: 'No indexed commit yet — push to main or run a sweep' }
  }

  if (opts.compare) {
    const parts = opts.compare.split('...')
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      return { ok: false, code: 'BAD_REQUEST', message: 'compare must be base...head' }
    }
    const files = await fetchCompareFiles(token, parsed.owner, parsed.repo, parts[0], parts[1])
    return {
      ok: true,
      data: {
        changed_paths: files,
        source: 'compare',
        meta: { base: parts[0], head: parts[1] },
      },
    }
  }

  // last_push / ref=HEAD~1 default
  const parentSha = await fetchCommitParent(token, parsed.owner, parsed.repo, headSha)
  if (!parentSha) {
    return { ok: false, code: 'NO_PARENT', message: 'Could not resolve parent commit for last push diff' }
  }
  const files = await fetchCompareFiles(token, parsed.owner, parsed.repo, parentSha, headSha)
  return {
    ok: true,
    data: {
      changed_paths: files,
      source: 'last_push',
      meta: { base: parentSha, head: headSha, ref: opts.ref ?? 'last_push' },
    },
  }
}

/** Invalidate cached tour/domains when index fingerprint changes. */
export async function invalidateCodebaseUnderstandCaches(
  db: SupabaseClient,
  projectId: string,
): Promise<void> {
  await Promise.all([
    db.from('project_codebase_tours').delete().eq('project_id', projectId),
    db.from('project_codebase_domains').delete().eq('project_id', projectId),
  ])
}
