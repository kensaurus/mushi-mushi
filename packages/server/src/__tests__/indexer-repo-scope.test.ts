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
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createFakeDb, findQueries } from './__stubs__/fake-query-recorder.ts'
import { isRepoUrl, projectIdsForRepo } from '../../supabase/functions/webhooks-github-indexer/repo-projects.ts'

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
  it('collects projects bound through project_repos and either settings column', async () => {
    const { db, queries } = createFakeDb((q) => {
      if (q.table === 'project_repos') {
        return { data: [
          { project_id: 'p-repos', repo_url: 'https://github.com/acme/app' },
          { project_id: 'p-other', repo_url: 'https://github.com/acme/app-two' },
        ] }
      }
      const column = String(q.filters.find((f) => f.method === 'ilike')?.args[0])
      if (column === 'github_repo_url') return { data: [{ project_id: 'p-settings', github_repo_url: 'https://github.com/Acme/App.git' }] }
      return { data: [{ project_id: 'p-repos', codebase_repo_url: 'https://github.com/acme/app' }] }
    })
    const ids = await projectIdsForRepo(db, 'acme/app')
    expect(ids.sort()).toEqual(['p-repos', 'p-settings'])
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
})

describe('webhooks-github-indexer wiring', () => {
  const src = readFileSync(resolve(__dirname, '../../supabase/functions/webhooks-github-indexer/index.ts'), 'utf8')
  const fn = (name: string) => src.split(`async function ${name}(`)[1]?.split('\nasync function ')[0] ?? ''

  it('check_run only matches attempts of the repository\'s projects', () => {
    const body = fn('handleCheckRun')
    expect(body).toMatch(/projectIdsForRepo\(db, payload\.repository\?\.full_name\)/)
    expect(body).toMatch(/\.from\('fix_attempts'\)\.select\('id, project_id'\)\.in\('project_id', projectIds\)/)
  })

  it('the cloud-agent head-ref fallback is scoped on both queries', () => {
    const body = fn('matchCloudAttemptByHeadRef')
    expect(body.match(/\.in\('project_id', projectIds\)/g)).toHaveLength(2)
    expect(fn('handlePullRequestState')).toMatch(/matchCloudAttemptByHeadRef\(db, headRef, repoProjectIds\)/)
  })

  it('push commit events stay inside the routed project', () => {
    expect(fn('emitCommitEventsForPush')).toMatch(/\.eq\('project_id', projectId\)\s*\.eq\('branch', branch\)/)
    expect(src).toMatch(/emitCommitEventsForPush\(\s*db,\s*projectId,/)
  })
})
