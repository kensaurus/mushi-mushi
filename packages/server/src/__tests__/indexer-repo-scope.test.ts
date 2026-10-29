/**
 * FILE: indexer-repo-scope.test.ts
 * PURPOSE: webhooks-github-indexer matched fix_attempts by branch name,
 *          commit SHA or head ref with no project filter. All GitHub App
 *          installations share one webhook secret, so a check_run, PR or push
 *          on a same-named branch in another installed repo updated another
 *          tenant's attempt and emitted fix_events under its project_id.
 *          Lookups are now scoped to the projects bound to the delivery's
 *          repository (repo-projects.ts), or to the push's routed project.
 *
 *          index.ts imports Deno globals, so its wiring is asserted at the
 *          source level; the resolver itself runs for real on a fake client.
 *          A hosted-gateway "Project not specified." on one of those reads
 *          stays on the transient path (503, no Sentry).
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createFakeDb, findQueries } from './__stubs__/fake-query-recorder.ts'
import { isRepoUrl, projectIdsForRepo, RepoLookupError } from '../../supabase/functions/webhooks-github-indexer/repo-projects.ts'
import { isTransientDbConnectionError } from '../../supabase/functions/_shared/error-codes.ts'

describe('isRepoUrl', () => {
  it('matches the repository case-insensitively, with or without .git or a trailing slash', () => {
    expect(isRepoUrl('https://github.com/Acme/app', 'acme/app')).toBe(true)
    expect(isRepoUrl('https://github.com/acme/app.git', 'acme/app')).toBe(true)
    expect(isRepoUrl('https://www.github.com/acme/app/', 'acme/app')).toBe(true)
  })

  it('rejects a longer name with the same prefix and a different owner', () => {
    expect(isRepoUrl('https://github.com/acme/app-two', 'acme/app')).toBe(false)
    expect(isRepoUrl('https://github.com/evil/app', 'acme/app')).toBe(false)
    expect(isRepoUrl(null, 'acme/app')).toBe(false)
  })
})

describe('projectIdsForRepo', () => {
  it('collects projects bound through project_repos, either settings column or their organization default', async () => {
    const { db, queries } = createFakeDb((q) => {
      if (q.table === 'project_repos') {
        return { data: [
          { project_id: 'p-repos', repo_url: 'https://github.com/acme/app' },
          { project_id: 'p-other', repo_url: 'https://github.com/acme/app-two' },
        ] }
      }
      if (q.table === 'organization_integration_settings') {
        return { data: [
          { organization_id: 'org-1', github_repo_url: 'https://github.com/acme/app' },
          { organization_id: 'org-2', github_repo_url: 'https://github.com/acme/app-two' },
        ] }
      }
      if (q.table === 'projects') return { data: [{ id: 'p-org' }] }
      const column = String(q.filters.find((f) => f.method === 'ilike')?.args[0])
      if (column === 'github_repo_url') return { data: [{ project_id: 'p-settings', github_repo_url: 'https://github.com/Acme/App.git' }] }
      return { data: [{ project_id: 'p-repos', codebase_repo_url: 'https://github.com/acme/app' }] }
    })
    const ids = await projectIdsForRepo(db, 'acme/app')
    expect(ids.sort()).toEqual(['p-org', 'p-repos', 'p-settings'])
    // Only the organization whose default is this exact repo.
    const orgLookup = findQueries(queries, 'projects')[0]
    expect(orgLookup?.filters).toContainEqual({ method: 'in', args: ['organization_id', ['org-1']] })
  })

  it('escapes LIKE wildcards in the repository name', async () => {
    const { db, queries } = createFakeDb(() => ({ data: [] }))
    await projectIdsForRepo(db, 'acme/my_app')
    const patterns = findQueries(queries, 'project_repos').flatMap((q) =>
      q.filters.filter((f) => f.method === 'ilike').map((f) => f.args[1]),
    )
    expect(patterns).toEqual(['%github.com/acme/my\\_app%'])
  })

  it('returns no projects for a payload without a repository', async () => {
    const { db, queries } = createFakeDb(() => ({ data: [] }))
    expect(await projectIdsForRepo(db, undefined)).toEqual([])
    expect(queries).toHaveLength(0)
  })

  it('throws on a read error so GitHub redelivers', async () => {
    const { db, queries } = createFakeDb(() => ({ data: null, error: { message: 'boom' } }))
    await expect(projectIdsForRepo(db, 'acme/app')).rejects.toThrow(/boom/)
  })

  it('a gateway "Project not specified" on github_repo_url is the transient class the route answers 503 for', async () => {
    const gateway = { message: 'Project not specified.', code: 'PGRST' }
    const { db } = createFakeDb((q) => {
      const column = String(q.filters.find((f) => f.method === 'ilike')?.args[0])
      if (q.table === 'project_settings' && column === 'github_repo_url') return { data: null, error: gateway }
      return { data: [] }
    })
    const err = await projectIdsForRepo(db, 'acme/app').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(RepoLookupError)
    expect((err as Error).message).toBe('project_settings.github_repo_url lookup failed: Project not specified.')
    expect(isTransientDbConnectionError((err as RepoLookupError).dbError)).toBe(true)
  })

  it('retries a lookup once on a statement timeout, then reports a second one (MUSHI-MUSHI-SERVER-2X)', async () => {
    const timeout = { message: 'canceling statement due to statement timeout', code: '57014' }
    let repoCalls = 0
    const { db } = createFakeDb((q) => {
      if (q.table !== 'project_repos') return { data: [] }
      repoCalls++
      return repoCalls === 1 ? { data: null, error: timeout } : { data: [{ project_id: 'p-repos', repo_url: 'https://github.com/acme/app' }] }
    })
    expect(await projectIdsForRepo(db, 'acme/app')).toEqual(['p-repos'])
    expect(repoCalls).toBe(2)

    const stalled = createFakeDb((q) => (q.table === 'project_repos' ? { data: null, error: timeout } : { data: [] }))
    await expect(projectIdsForRepo(stalled.db, 'acme/app')).rejects.toThrow(/project_repos\.repo_url lookup failed: canceling statement/)
    expect(findQueries(stalled.queries, 'project_repos')).toHaveLength(2)
  })

  it('retries a gateway HTML page once and keeps the page out of the message (MUSHI-9d390abc)', async () => {
    const gatewayHtml = {
      message: '<!DOCTYPE html><html><head><title>supabase.co | 502: Bad gateway</title></head><body>cloudflare</body></html>',
      code: '502',
    }
    let repoCalls = 0
    const { db } = createFakeDb((q) => {
      if (q.table !== 'project_repos') return { data: [] }
      repoCalls++
      return repoCalls === 1
        ? { data: null, error: gatewayHtml }
        : { data: [{ project_id: 'p-repos', repo_url: 'https://github.com/acme/app' }] }
    })
    expect(await projectIdsForRepo(db, 'acme/app')).toEqual(['p-repos'])
    expect(repoCalls).toBe(2)

    const stalled = createFakeDb((q) => (q.table === 'project_repos' ? { data: null, error: gatewayHtml } : { data: [] }))
    const err = await projectIdsForRepo(stalled.db, 'acme/app').catch((e: unknown) => e)
    expect(findQueries(stalled.queries, 'project_repos')).toHaveLength(2)
    expect((err as Error).message).toBe(
      'project_repos.repo_url lookup failed: [upstream gateway error] supabase.co | 502: Bad gateway',
    )
    expect((err as Error).message).not.toContain('<!DOCTYPE')
    // The untouched PostgREST error still rides along, so the route answers 503.
    expect(isTransientDbConnectionError((err as RepoLookupError).dbError)).toBe(true)
  })

  it('does not retry other read errors', async () => {
    const { db, queries } = createFakeDb(() => ({ data: null, error: { message: 'boom', code: '42703' } }))
    await expect(projectIdsForRepo(db, 'acme/app')).rejects.toThrow(/boom/)
    expect(findQueries(queries, 'project_repos')).toHaveLength(1)
  })

  it('keeps the PostgREST error on the throw, so the route can classify it (MUSHI-MUSHI-SERVER-2S)', async () => {
    const pooler = { message: 'upstream connect error ... delayed connect error: 111', code: null }
    const { db } = createFakeDb(() => ({ data: null, error: pooler }))
    const err = await projectIdsForRepo(db, 'acme/app').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(RepoLookupError)
    expect((err as RepoLookupError).dbError).toBe(pooler)
    expect((err as Error).message).toMatch(/lookup failed: upstream connect error/)
  })
})

describe('webhooks-github-indexer wiring', () => {
  const src = readFileSync(resolve(__dirname, '../../supabase/functions/webhooks-github-indexer/index.ts'), 'utf8')
  const fn = (name: string) => src.split(`async function ${name}(`)[1]?.split('\nasync function ')[0] ?? ''

  it('check_run only matches attempts of the repository\'s projects', () => {
    const body = fn('handleCheckRun')
    expect(body).toMatch(/projectIdsForRepo\(db, payload\.repository\?\.full_name\)/)
    expect(body).toMatch(/\.from\('fix_attempts'\)\.select\('id, project_id'\)\.in\('project_id', projectIds\)/)
    expect(body).toMatch(/applyHeadCheckRollup\(db as unknown as HeadCheckDb, \[attempt\.id\], 'one'/)
  })

  it('the cloud-agent head-ref fallback is scoped on both queries', () => {
    const body = fn('matchCloudAttemptByHeadRef')
    expect(body.match(/\.in\('project_id', projectIds\)/g)).toHaveLength(2)
    expect(fn('handlePullRequestState')).toMatch(/matchCloudAttemptByHeadRef\(db, headRef, repoProjectIds\)/)
  })

  it('a transient repo-binding lookup answers 503 with a warn; other errors still reach Sentry', () => {
    const onError = src.split('app.onError(')[1]?.split('\n});')[0] ?? ''
    expect(onError).toMatch(/err instanceof RepoLookupError && isTransientDbConnectionError\(err\.dbError\)/)
    expect(onError).toMatch(/log\.warn\(/)
    expect(onError).toMatch(/, 503\)/)
    expect(onError).toMatch(/return sentryHonoErrorHandler\(err, c\)/)
    expect(src).toMatch(/logDbFailure\(log, 'push: project_repos lookup failed', projectErr,/)
  })

  it('push commit events stay inside the routed project', () => {
    expect(fn('emitCommitEventsForPush')).toMatch(/\.eq\('project_id', projectId\)\s*\.eq\('branch', branch\)/)
    expect(src).toMatch(/emitCommitEventsForPush\(\s*db,\s*projectId,/)
  })
})
