import { describe, expect, it, vi } from 'vitest'
import type * as ConfigModule from '../config.js'
import { okReply, runCli } from '../test-harness.js'
import { registerRecipeCommands } from './recipe.js'

vi.mock('../config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof ConfigModule>()
  return {
    ...actual,
    loadConfig: () => ({ apiKey: 'mushi_test_key_0123', endpoint: 'https://api.test/functions/v1/api', projectId: '11111111-2222-4333-8444-555555555555' }), // gitleaks:allow — fake key for the CLI test harness
  }
})

const PID = '11111111-2222-4333-8444-555555555555'
const JOB = '22222222-3333-4444-8555-666666666666'

describe('mushi recipe sources', () => {
  it('lists the editable files of one element with their sha', async () => {
    const run = await runCli(registerRecipeCommands, ['recipe', 'sources', '--element', 'env'], () => okReply({
      ok: true, element: 'env', branch: 'main', headSha: 'abcdef1234',
      files: [
        { path: '.env.example', exists: true, content: 'A=1\n', sha: '1234567890', writable: true, reason: null },
        { path: 'apps/web/.env.example', exists: false, content: null, sha: null, writable: true, reason: null },
      ],
    }))
    expect(run.calls[0]!.path).toBe(`/v1/admin/projects/${PID}/recipe/sources?element=env`)
    expect(run.stdout).toContain('env on main @ abcdef1')
    expect(run.stdout).toContain('writable .env.example  (4 chars, sha 1234567)')
    expect(run.stdout).toContain('(new file)')
  })

  it('says why nothing is editable', async () => {
    const run = await runCli(registerRecipeCommands, ['recipe', 'sources', '--element', 'gates'], () => okReply({ ok: false, element: 'gates', reason: 'This repo has no valid mushi.recipe.json', files: [] }))
    expect(run.stdout).toContain('Nothing editable: This repo has no valid mushi.recipe.json')
  })

  it('refuses an element the route cannot edit before calling the API', async () => {
    const run = await runCli(registerRecipeCommands, ['recipe', 'sources', '--element', 'design'])
    expect(run.calls).toHaveLength(0)
    expect(run.error?.code).toBe('E_INVALID_INPUT')
  })
})

describe('mushi recipe change', () => {
  it('reads one job and prints its draft PR', async () => {
    const run = await runCli(registerRecipeCommands, ['recipe', 'change', JOB], () => okReply({
      id: JOB, element: 'gates', status: 'pr_opened', pr_url: 'https://github.com/o/r/pull/7', branch: 'mushi/recipe', error: null, created_at: '2026-10-01T00:00:00Z', finished_at: '2026-10-01T00:01:00Z',
    }))
    expect(run.calls[0]!.path).toBe(`/v1/admin/projects/${PID}/recipe/changes/${JOB}`)
    expect(run.stdout).toContain('pr_opened')
    expect(run.stdout).toContain('Draft PR: https://github.com/o/r/pull/7')
  })

  it('rejects a job id that is not a uuid', async () => {
    const run = await runCli(registerRecipeCommands, ['recipe', 'change', 'nope'])
    expect(run.calls).toHaveLength(0)
    expect(run.exitCode).not.toBe(0)
  })
})
