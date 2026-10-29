import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { collapseCheckRuns, installationIdForAttempt, isAdvisoryCheckRun, prNumberFromUrl, supersededWorkflowRunIds, withoutSupersededWorkflowRuns } from '../../supabase/functions/_shared/github.ts'

describe('collapseCheckRuns', () => {
  it('ignores the Copilot review run when the CI jobs passed', () => {
    expect(collapseCheckRuns([
      { name: 'copilot-pull-request-reviewer', status: 'completed', conclusion: 'failure' },
      { name: 'gate', status: 'completed', conclusion: 'success' },
    ])).toEqual({ status: 'completed', conclusion: 'success' })
  })

  it('does not wait on a pending Copilot review', () => {
    expect(collapseCheckRuns([
      { name: 'copilot-pull-request-reviewer', status: 'in_progress', conclusion: null },
      { name: 'gate', status: 'completed', conclusion: 'success' },
    ])).toEqual({ status: 'completed', conclusion: 'success' })
  })

  it('keeps a real CI failure red', () => {
    expect(collapseCheckRuns([
      { name: 'lint', status: 'completed', conclusion: 'success' },
      { name: 'test', status: 'completed', conclusion: 'failure' },
    ])).toEqual({ status: 'completed', conclusion: 'failure' })
  })

  it('stays pending while any CI job runs', () => {
    expect(collapseCheckRuns([
      { name: 'lint', status: 'completed', conclusion: 'success' },
      { name: 'test', status: 'queued', conclusion: null },
    ])).toEqual({ status: 'in_progress', conclusion: null })
  })

  it('an older workflow run that overlaps the green re-run is not the head (report 9e2ec6f0)', () => {
    // The re-run started before the first run finished, so name-and-time
    // collapse keeps the failure. GitHub's merge box does not: it scores
    // only the newest run of that workflow. yen-yen#364.
    const checks = [
      {
        name: 'Lint, typecheck, build, doctor',
        status: 'completed',
        conclusion: 'failure',
        started_at: '2026-10-26T20:50:00Z',
        completed_at: '2026-10-26T21:00:00Z',
        details_url: 'https://github.com/kensaurus/yen-yen/actions/runs/100/job/1',
        check_suite: { id: 10 },
      },
      {
        name: 'Lint, typecheck, build, doctor',
        status: 'completed',
        conclusion: 'success',
        started_at: '2026-10-26T20:55:00Z',
        completed_at: '2026-10-26T21:03:00Z',
        details_url: 'https://github.com/kensaurus/yen-yen/actions/runs/200/job/2',
        check_suite: { id: 20 },
      },
    ]
    expect(collapseCheckRuns(checks).conclusion).toBe('failure')
    const runs = [
      { id: 100, workflow_id: 7, check_suite_id: 10, created_at: '2026-10-26T20:50:00Z' },
      { id: 200, workflow_id: 7, check_suite_id: 20, created_at: '2026-10-26T20:55:00Z' },
    ]
    expect([...supersededWorkflowRunIds(runs)]).toEqual([100])
    expect(collapseCheckRuns(withoutSupersededWorkflowRuns(checks, runs))).toEqual({ status: 'completed', conclusion: 'success' })
  })

  it('drops a superseded run by check suite when the job URL has no run id', () => {
    const checks = [
      { name: 'test', status: 'completed', conclusion: 'cancelled', started_at: '2026-10-26T20:50:00Z', completed_at: '2026-10-26T21:00:00Z', details_url: 'https://github.com/o/r/runs/1', check_suite: { id: 10 } },
      { name: 'test', status: 'completed', conclusion: 'success', started_at: '2026-10-26T20:55:00Z', completed_at: '2026-10-26T21:03:00Z', details_url: 'https://github.com/o/r/actions/runs/200/job/2', check_suite: { id: 20 } },
    ]
    const runs = [
      { id: 100, workflow_id: 7, check_suite_id: 10, created_at: '2026-10-26T20:50:00Z' },
      { id: 200, workflow_id: 7, check_suite_id: 20, created_at: '2026-10-26T20:55:00Z' },
    ]
    expect(collapseCheckRuns(withoutSupersededWorkflowRuns(checks, runs)).conclusion).toBe('success')
  })

  it('a newer failed run of the same workflow still counts', () => {
    const checks = [
      { name: 'test', status: 'completed', conclusion: 'success', started_at: '2026-10-26T20:50:00Z', completed_at: '2026-10-26T20:56:00Z', details_url: 'https://github.com/o/r/actions/runs/100/job/1' },
      { name: 'test', status: 'completed', conclusion: 'failure', started_at: '2026-10-26T21:00:00Z', completed_at: '2026-10-26T21:05:00Z', details_url: 'https://github.com/o/r/actions/runs/200/job/2' },
    ]
    const runs = [
      { id: 100, workflow_id: 7, check_suite_id: 10, created_at: '2026-10-26T20:50:00Z' },
      { id: 200, workflow_id: 7, check_suite_id: 20, created_at: '2026-10-26T21:00:00Z' },
    ]
    expect(collapseCheckRuns(withoutSupersededWorkflowRuns(checks, runs)).conclusion).toBe('failure')
  })

  it('two workflows that share a job name both still count', () => {
    const checks = [
      { name: 'test', status: 'completed', conclusion: 'failure', started_at: '2026-10-26T20:50:00Z', completed_at: '2026-10-26T20:56:00Z', details_url: 'https://github.com/o/r/actions/runs/1/job/1' },
      { name: 'test', status: 'completed', conclusion: 'success', started_at: '2026-10-26T20:50:05Z', completed_at: '2026-10-26T20:58:00Z', details_url: 'https://github.com/o/r/actions/runs/2/job/2' },
    ]
    const runs = [
      { id: 1, workflow_id: 10, check_suite_id: 10, created_at: '2026-10-26T20:50:00Z' },
      { id: 2, workflow_id: 11, check_suite_id: 11, created_at: '2026-10-26T20:50:05Z' },
    ]
    expect(collapseCheckRuns(withoutSupersededWorkflowRuns(checks, runs)).conclusion).toBe('failure')
  })

  it('a run without a workflow id is never treated as replaced', () => {
    expect([...supersededWorkflowRunIds([
      { id: 1, workflow_id: null, check_suite_id: null, created_at: '2026-10-26T20:50:00Z' },
      { id: 2, workflow_id: null, check_suite_id: null, created_at: '2026-10-26T21:00:00Z' },
    ])]).toEqual([])
  })

  it('a green re-run of a failed check replaces the red run (report 9e2ec6f0)', () => {
    expect(collapseCheckRuns([
      { name: 'Lint, typecheck, build, doctor', status: 'completed', conclusion: 'failure', started_at: '2026-10-26T20:50:00Z', completed_at: '2026-10-26T20:56:41Z' },
      { name: 'Lint, typecheck, build, doctor', status: 'completed', conclusion: 'success', started_at: '2026-10-26T20:58:00Z', completed_at: '2026-10-26T21:03:30Z' },
    ])).toEqual({ status: 'completed', conclusion: 'success' })
  })

  it('a re-run attempt of the same Actions run replaces the earlier attempt', () => {
    expect(collapseCheckRuns([
      { name: 'test', status: 'completed', conclusion: 'failure', started_at: '2026-10-26T20:50:00Z', completed_at: '2026-10-26T20:59:00Z', details_url: 'https://github.com/o/r/actions/runs/77/job/1' },
      { name: 'test', status: 'completed', conclusion: 'success', started_at: '2026-10-26T20:58:00Z', completed_at: '2026-10-26T21:03:30Z', details_url: 'https://github.com/o/r/actions/runs/77/job/2' },
    ])).toEqual({ status: 'completed', conclusion: 'success' })
  })

  it('two workflows with a job of the same name running side by side: red stays red', () => {
    expect(collapseCheckRuns([
      { name: 'test', status: 'completed', conclusion: 'failure', started_at: '2026-10-26T20:50:00Z', completed_at: '2026-10-26T20:56:00Z', details_url: 'https://github.com/o/r/actions/runs/1/job/1' },
      { name: 'test', status: 'completed', conclusion: 'success', started_at: '2026-10-26T20:50:05Z', completed_at: '2026-10-26T20:58:00Z', details_url: 'https://github.com/o/r/actions/runs/2/job/2' },
    ])).toEqual({ status: 'completed', conclusion: 'failure' })
  })

  it('a later run of a check from another app does not replace it', () => {
    expect(collapseCheckRuns([
      { name: 'build', status: 'completed', conclusion: 'failure', started_at: '2026-10-26T20:50:00Z', completed_at: '2026-10-26T20:51:00Z', app: { id: 1 } },
      { name: 'build', status: 'completed', conclusion: 'success', started_at: '2026-10-26T21:00:00Z', completed_at: '2026-10-26T21:01:00Z', app: { id: 2 } },
    ])).toEqual({ status: 'completed', conclusion: 'failure' })
  })

  it('a re-run still running keeps the head pending', () => {
    expect(collapseCheckRuns([
      { name: 'test', status: 'completed', conclusion: 'failure', started_at: '2026-10-26T20:50:00Z', completed_at: '2026-10-26T20:56:00Z' },
      { name: 'test', status: 'in_progress', conclusion: null, started_at: '2026-10-26T21:00:00Z' },
    ])).toEqual({ status: 'in_progress', conclusion: null })
  })

  it('reports nothing when only the review run exists', () => {
    expect(collapseCheckRuns([
      { name: 'copilot-pull-request-reviewer', status: 'completed', conclusion: 'failure' },
    ])).toEqual({ status: null, conclusion: null })
  })
})

describe('isAdvisoryCheckRun', () => {
  it('matches only review runs', () => {
    expect(isAdvisoryCheckRun({ name: 'copilot-pull-request-reviewer' })).toBe(true)
    expect(isAdvisoryCheckRun({ name: 'gate' })).toBe(false)
    expect(isAdvisoryCheckRun({})).toBe(false)
  })
})

describe('cloud-agent PRs reach the merge and CI paths', () => {
  const FUNCTIONS = resolve(__dirname, '../../supabase/functions')
  const ciSync = readFileSync(resolve(FUNCTIONS, 'ci-sync/index.ts'), 'utf8')

  it('parses the PR number a cloud agent hands back as a URL', () => {
    expect(prNumberFromUrl('https://github.com/kensaurus/glot.it/pull/141')).toBe(141)
    expect(prNumberFromUrl('https://github.com/kensaurus/glot.it/pull/141/files')).toBe(141)
    expect(prNumberFromUrl('https://github.com/kensaurus/glot.it')).toBeNull()
  })

  it('ci-sync backfills pr_number and commit_sha from the PR it reads', () => {
    expect(ciSync).toContain('pr_number: attempt.pr_number ?? prNumber')
    expect(ciSync).toContain('commit_sha: pr.headSha')
  })

  it('ci-sync reads CI on the PR head, falling back to the stored commit', () => {
    expect(ciSync).toContain('const sha = headSha ?? attempt.commit_sha')
    expect(ciSync).toContain('fetchLatestCheckRun(token, ref, sha)')
  })
})

describe('installationIdForAttempt', () => {
  const repos = [
    { id: 'r-docs', repo_url: 'https://github.com/kensaurus/sbc-docs', is_primary: true, github_app_installation_id: 111 },
    { id: 'r-be', repo_url: 'https://github.com/kensaurus/sbc_backend', is_primary: false, github_app_installation_id: 222 },
  ]
  const fakeDb = {
    from: () => ({
      select: () => {
        const filters: Record<string, unknown> = {}
        const q = {
          eq: (col: string, val: unknown) => { filters[col] = val; return q },
          maybeSingle: async () => ({ data: repos.find((r) => r.id === filters.id) ?? null }),
          then: (resolve: (v: { data: typeof repos }) => unknown) => resolve({ data: repos }),
        }
        return q
      },
    }),
  } as unknown as Parameters<typeof installationIdForAttempt>[0]

  it('matches the PR repository when the attempt has no repo_id', async () => {
    expect(await installationIdForAttempt(fakeDb, {
      project_id: 'p', repo_id: null, pr_url: 'https://github.com/kensaurus/sbc_backend/pull/9',
    })).toBe(222)
  })

  it('uses repo_id when the attempt has one', async () => {
    expect(await installationIdForAttempt(fakeDb, { project_id: 'p', repo_id: 'r-docs', pr_url: null })).toBe(111)
  })

  it('falls back to the primary repo without a PR URL', async () => {
    expect(await installationIdForAttempt(fakeDb, { project_id: 'p', repo_id: null, pr_url: null })).toBe(111)
  })
})
