import { describe, expect, it, vi } from 'vitest'
import type * as ConfigModule from '../config.js'
import { okReply, runCli } from '../test-harness.js'
import { registerUxRunsCommands } from './ux-runs.js'
import { registerPortfolioCommands } from './portfolio.js'

vi.mock('../config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof ConfigModule>()
  return {
    ...actual,
    loadConfig: () => ({ apiKey: 'mushi_test_key_0123', endpoint: 'https://api.test/functions/v1/api', projectId: '11111111-2222-4333-8444-555555555555' }), // gitleaks:allow — fake key for the CLI test harness
  }
})

const PID = '11111111-2222-4333-8444-555555555555'
const RUN = '20261006-011207-qafu'
const GID = '0a000000-0000-4000-8000-000000000000'
const P2 = '1b000000-0000-4000-8000-000000000000'

describe('mushi ux-runs', () => {
  it('lists runs with what happened to their screens', async () => {
    const run = await runCli(registerUxRunsCommands, ['ux-runs', 'list'], () =>
      okReply({ runs: [{ local_run_id: RUN, status: 'done', agent: 'claude-code', model: null, branch: 'b', counts: { accepted: 2, regressed: 1 }, started_at: '' }] }),
    )
    expect(run.calls[0].path).toBe(`/v1/admin/projects/${PID}/ux-runs`)
    expect(run.stdout).toContain(`${RUN}  done`)
    expect(run.stdout).toContain('improved 2 · rolled back 0 · moved 1 · blocked 0')
  })

  it('shows screens that need a look first', async () => {
    const run = await runCli(registerUxRunsCommands, ['ux-runs', 'show', RUN], () =>
      okReply({
        run: { branch: `mushi-ux/${RUN}` },
        surfaces: [
          { surface_key: 'home', path: '/', label: 'Home', status: 'accepted', note: null, penalty_before: 4, penalty_after: 0, report_id: null },
          { surface_key: 'about', path: '/about', label: 'About', status: 'regressed', note: 'moved', penalty_before: 0, penalty_after: null, report_id: null },
        ],
      }),
    )
    const lines = run.stdout.split('\n')
    expect(lines[0]).toBe(`Kept changes: mushi-ux/${RUN}`)
    expect(lines[2]).toMatch(/^moved by another fix\s+About/)
    expect(run.stdout).toContain('score 4→0')
  })

  it('files a screen as a bug and refuses malformed ids', async () => {
    const filed = await runCli(registerUxRunsCommands, ['ux-runs', 'file', RUN, 'about-69bbc6'], () => okReply({ report_id: 'r1', reused: false }))
    expect(filed.calls[0]).toMatchObject({ method: 'POST', path: `/v1/admin/projects/${PID}/ux-runs/${RUN}/surfaces/about-69bbc6/report` })
    expect(filed.stdout).toContain('Filed report r1')
    const bad = await runCli(registerUxRunsCommands, ['ux-runs', 'show', '../x'])
    expect(bad.calls).toHaveLength(0)
    expect(bad.exitCode).not.toBe(0)
  })
})

describe('mushi portfolio groups', () => {
  it('lists, creates and sets group members', async () => {
    const list = await runCli(registerPortfolioCommands, ['portfolio', 'groups', 'list'], () =>
      okReply({ groups: [{ id: GID, name: 'Kensaurus apps', slug: 'kensaurus-apps', project_ids: [PID] }] }),
    )
    expect(list.calls[0].path).toBe('/v1/admin/orgs/current/project-groups')
    expect(list.stdout).toContain('kensaurus-apps')
    expect(list.stdout).toContain('(1 app)')

    const add = await runCli(registerPortfolioCommands, ['portfolio', 'groups', 'add', 'Client work'], () =>
      okReply({ group: { id: GID, name: 'Client work', slug: 'client-work', project_ids: [] } }),
    )
    expect(add.calls[0]).toMatchObject({ method: 'POST', body: { name: 'Client work' } })

    const set = await runCli(registerPortfolioCommands, ['portfolio', 'groups', 'set', GID, PID, P2], () => okReply({ added: 2, removed: 0 }))
    expect(set.calls[0]).toMatchObject({ method: 'PUT', path: `/v1/admin/orgs/current/project-groups/${GID}/projects`, body: { project_ids: [PID, P2] } })
    expect(set.stdout).toContain('Added 2, removed 0.')
  })

  it('narrows portfolio show to a group', async () => {
    const run = await runCli(registerPortfolioCommands, ['portfolio', 'show', '--group', 'kensaurus-apps', '--json'], () => okReply({ cards: [] }))
    expect(run.calls[0].path).toBe('/v1/admin/orgs/current/portfolio?page=1&group=kensaurus-apps')
  })
})
