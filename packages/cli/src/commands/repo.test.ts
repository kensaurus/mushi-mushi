import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type * as ConfigModule from '../config.js'
import { okReply, runCli } from '../test-harness.js'
import { registerRepoCommands } from './repo.js'

vi.mock('../config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof ConfigModule>()
  return {
    ...actual,
    loadConfig: () => ({ apiKey: 'mushi_test_key_0123', endpoint: 'https://api.test/functions/v1/api', projectId: '11111111-2222-4333-8444-555555555555' }),
  }
})

const PID = '11111111-2222-4333-8444-555555555555'
const REPORT = '44444444-5555-4666-8777-888888888888'

const digest = {
  owner: 'me', repo: 'app', sha: 'abcdef1234567', ref: 'main', budget_tokens: 50000, total_tokens: 1200, eligible_files: 40,
  files: [{ path: 'src/login.ts', tokens: 300, truncated: false }],
  dropped_counts: { budget: 12, binary: 0 }, redacted: [{ path: '.env.example', label: 'AWS key' }], tree_truncated: false,
  scope: { kind: 'report', label: 'files linked to report 44444444 (1)' }, cached: false, text: '# me/app\nsrc/login.ts\n',
}

describe('mushi repo digest', () => {
  it('passes the scope flags and prints only the text on stdout', async () => {
    const run = await runCli(registerRepoCommands, ['repo', 'digest', '--report', REPORT, '--budget', '50000'], () => okReply(digest))
    expect(run.calls[0]!.path).toBe(`/v1/admin/projects/${PID}/codebase/digest?report_id=${REPORT}&budget=50000`)
    expect(run.stdout).toBe('# me/app\nsrc/login.ts\n')
    expect(run.stderr).toContain('me/app@abcdef1 (main)')
    expect(run.stderr).toContain('left out: 12 budget')
    expect(run.stderr).toContain('secrets removed from 1 file(s)')
  })

  it('writes the text to --out', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mushi-digest-'))
    try {
      const out = join(dir, 'digest.txt')
      const run = await runCli(registerRepoCommands, ['repo', 'digest', '--out', out], () => okReply(digest))
      expect(readFileSync(out, 'utf8')).toBe(digest.text)
      expect(run.stdout).toContain(`Wrote ${out}.`)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rejects a malformed report id before calling the API', async () => {
    const run = await runCli(registerRepoCommands, ['repo', 'digest', '--report', 'r1'])
    expect(run.calls).toHaveLength(0)
    expect(run.error?.code).toBe('E_INVALID_INPUT')
  })
})

const diagram = {
  diagram: {
    id: 'd1', commit_sha: 'abcdef1234567', repo_owner: 'me', repo_name: 'app', model: 'claude', updated_at: '2026-10-01T00:00:00Z',
    graph: { groups: [{ id: 'web', label: 'Web' }], nodes: [{ id: 'login', label: 'Login', group: 'web', path: 'src/login.ts' }], edges: [{}] },
  },
  publication: { published: false },
}

describe('mushi repo diagram', () => {
  it('show prints an outline', async () => {
    const run = await runCli(registerRepoCommands, ['repo', 'diagram', 'show'], () => okReply(diagram))
    expect(run.calls[0]!.path).toBe(`/v1/admin/projects/${PID}/codebase/diagram`)
    expect(run.stdout).toContain('me/app@abcdef1')
    expect(run.stdout).toContain('- Login  (src/login.ts)')
    expect(run.stdout).toContain('Not published')
  })

  it('generate posts force', async () => {
    const run = await runCli(registerRepoCommands, ['repo', 'diagram', 'generate', '--force'], () => okReply({ ...diagram, reused: false }))
    expect(run.calls[0]).toMatchObject({ method: 'POST', path: `/v1/admin/projects/${PID}/codebase/diagram`, body: { force: true } })
  })

  it('publish previews, then needs --yes', async () => {
    const preview = okReply({ diagram_id: 'd1', repo_private: false, payload_hash: 'h1', url: 'https://x/r/me/app', can_publish: true, publish_blocked_reason: null })
    const run = await runCli(registerRepoCommands, ['repo', 'diagram', 'publish'], () => preview)
    expect(run.calls.map((c) => c.path)).toEqual([`/v1/admin/projects/${PID}/codebase/diagram/publish-preview`])
    expect(run.stdout).toContain('Will publish to https://x/r/me/app')
    expect(run.error?.message).toContain('--yes')
  })

  it('publish sends the previewed hash and never confirms a private repo', async () => {
    const run = await runCli(registerRepoCommands, ['repo', 'diagram', 'publish', '--yes'], (c) =>
      c.path.endsWith('publish-preview')
        ? okReply({ diagram_id: 'd1', repo_private: false, payload_hash: 'h1', url: 'https://x/r/me/app', can_publish: true, publish_blocked_reason: null })
        : okReply({ url: 'https://x/r/me/app', commit_sha: 'abc', badge_markdown: '[![diagram](b)](u)' }))
    expect(run.calls[1]).toMatchObject({ method: 'POST', path: `/v1/admin/projects/${PID}/codebase/diagram/publish`, body: { diagram_id: 'd1', payload_hash: 'h1' } })
    expect(run.calls[1]!.body).not.toHaveProperty('confirm_private')
    expect(run.stdout).toContain('Published: https://x/r/me/app')
  })

  it('publish stops with the server reason when it cannot publish', async () => {
    const run = await runCli(registerRepoCommands, ['repo', 'diagram', 'publish', '--yes'], () =>
      okReply({ diagram_id: 'd1', repo_private: true, payload_hash: 'h1', url: 'u', can_publish: false, publish_blocked_reason: 'A private repo can only be published from the console.' }))
    expect(run.calls).toHaveLength(1)
    expect(run.error?.message).toContain('private repo')
  })

  it('unpublish needs --yes and sends DELETE', async () => {
    const without = await runCli(registerRepoCommands, ['repo', 'diagram', 'unpublish'])
    expect(without.calls).toHaveLength(0)
    const run = await runCli(registerRepoCommands, ['repo', 'diagram', 'unpublish', '--yes'], () => okReply({ published: false }))
    expect(run.calls[0]).toMatchObject({ method: 'DELETE', path: `/v1/admin/projects/${PID}/codebase/diagram/publish` })
  })
})
