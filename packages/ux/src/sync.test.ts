// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest'
import type { RunState } from './state.js'
import { syncableStep, syncConfigFromEnv, toSnapshot } from './sync.js'

const probes = { axe: [{ id: 'color-contrast', impact: 'serious', help: 'Contrast', count: 3, targets: ['.a'] }], overflowX: false, smallTargets: 1, consoleErrors: ['boom'], cls: 0 }

const state: RunState = {
  version: 1,
  runId: '20261006-011207-qafu',
  baseUrl: 'http://localhost:5173',
  createdAt: '2026-10-06T01:12:07.000Z',
  updatedAt: '',
  agent: 'claude-code',
  model: null,
  judgeModel: 'claude-opus-5-5',
  worktree: '/w',
  branch: 'mushi-ux/20261006-011207-qafu',
  baseSha: '57cd809c',
  surfaces: [
    {
      surface: { key: 'root-42099b', kind: 'page', path: '/', steps: [], label: 'Home', domHash: 'h' },
      status: 'accepted',
      note: 'Kept',
      baseline: { desktop: { png: 'shots/b.png', probes, penalty: 13 } },
      iterations: [
        {
          n: 1, agent: 'claude-code', model: null, startedAt: '', durationMs: 22000, outcome: 'accepted', reason: 'Kept',
          commitSha: 'bbc51b74', pixelDiff: { desktop: 0.009 }, logTail: 'agent output stays local',
          after: { desktop: { png: 'shots/a.png', probes: { ...probes, axe: [], consoleErrors: [] }, penalty: 1 } },
          diffPng: { desktop: 'shots/d.png' },
        },
      ],
    },
  ],
}

describe('toSnapshot', () => {
  it('sends scores, probe counts and attempts, but not console text or agent output', () => {
    const snap = toSnapshot(state, true, new Map([['root-42099b/before-desktop.png', 'shots/b.png']]))
    expect(snap).toMatchObject({ status: 'done', agent: 'claude-code', judge_model: 'claude-opus-5-5', base_sha: '57cd809c' })
    const s = snap.surfaces[0]
    expect(s).toMatchObject({ surface_key: 'root-42099b', status: 'accepted', penalty_before: 13, penalty_after: 1 })
    expect(s.probe_before).toEqual({ axe: [{ id: 'color-contrast', impact: 'serious', help: 'Contrast', count: 3 }], overflowX: false, smallTargets: 1, consoleErrors: 1, cls: 0 })
    expect(s.thumbs).toEqual({ before: 'root-42099b/before-desktop.png', after: null, diff: null })
    expect(s.shots).toEqual({ 'before-desktop': 'root-42099b/before-desktop.png' })
    expect(s.iterations[0]).toEqual({ n: 1, agent: 'claude-code', model: null, duration_ms: 22000, outcome: 'accepted', reason: 'Kept', commit_sha: 'bbc51b74', pixel_diff: { desktop: 0.009 }, penalty_after: 1, steps: null, step: null, shots: {} })
    expect(JSON.stringify(snap)).not.toContain('boom')
    expect(JSON.stringify(snap)).not.toContain('agent output stays local')
  })

  it('sends which files the agent read and edited, never what it said or ran', () => {
    const log = ['› The key is sk-live-123', '[read] app/page.tsx', '[run] curl -H "Authorization: Bearer x" api', '[find] token', '[edit] app/globals.css', '[error] boom', '{"type":"tool_call"}', '[done] Finished'].join('\n')
    expect(syncableStep('[run] curl -H "Authorization: Bearer x" api')).toBe('[run] a command')
    const withLog = structuredClone(state)
    withLog.surfaces[0]!.iterations[0]!.logTail = log
    withLog.current = { surface: 'root-42099b', attempt: 2, startedAt: '2026-10-06T09:00:00.000Z', steps: 3, lastStep: '› secret plan', files: ['a.ts'], timeoutMs: 600000 }
    const snap = toSnapshot(withLog, false, new Map())
    expect(snap.surfaces[0]!.iterations[0]!.steps).toBe('[read] app/page.tsx\n[run] a command\n[find] a search\n[edit] app/globals.css\n[done] Finished')
    expect(snap.current_progress).toEqual({ steps: 3, last_step: null, files: ['a.ts'], started_at: '2026-10-06T09:00:00.000Z', timeout_ms: 600000 })
    expect(JSON.stringify(snap)).not.toMatch(/sk-live|Bearer|secret plan|boom/)
  })

  it('sends a small-steps plan as a checklist and names the step each attempt made', () => {
    const planned = structuredClone(state)
    const s0 = planned.surfaces[0]!
    s0.plan = { steps: [{ text: 'Darken the muted text', status: 'done', attempt: 1 }, { text: 'Shorten the hero copy', status: 'pending' }] }
    s0.iterations[0]!.step = 'Darken the muted text'
    const snap = toSnapshot(planned, false, new Map()).surfaces[0]!
    expect(snap.plan).toEqual([
      { text: 'Darken the muted text', status: 'done', attempt: 1 },
      { text: 'Shorten the hero copy', status: 'pending', attempt: null },
    ])
    expect(snap.iterations[0]!.step).toBe('Darken the muted text')
    expect(toSnapshot(state, false, new Map()).surfaces[0]!.plan).toBeNull()
  })

  it('reports the worse of the phone and desktop scores, so a rejected attempt never shows 0', () => {
    const both = structuredClone(state)
    const it0 = both.surfaces[0]!.iterations[0]!
    const desktop = it0.after.desktop!
    it0.after = { desktop: { ...desktop, penalty: 0 }, mobile: { ...desktop, penalty: 2 } }
    expect(toSnapshot(both, false, new Map()).surfaces[0]!.iterations[0]!.penalty_after).toBe(2)
  })
})

describe('syncConfigFromEnv', () => {
  it('needs a key and a project, and defaults to Mushi Cloud', () => {
    expect(syncConfigFromEnv({})).toBeNull()
    expect(syncConfigFromEnv({ MUSHI_API_KEY: 'k', MUSHI_PROJECT_ID: 'p' })?.endpoint).toBe('https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/api')
    expect(syncConfigFromEnv({ MUSHI_API_KEY: 'k', MUSHI_PROJECT_ID: 'p', MUSHI_API_ENDPOINT: 'https://self.host/api/' })?.endpoint).toBe('https://self.host/api')
  })

  it('marks a run on GitHub Actions as a cloud run', () => {
    expect(syncConfigFromEnv({ MUSHI_API_KEY: 'k', MUSHI_PROJECT_ID: 'p' })?.mode).toBe('local')
    expect(syncConfigFromEnv({ MUSHI_API_KEY: 'k', MUSHI_PROJECT_ID: 'p', GITHUB_ACTIONS: 'true' })?.mode).toBe('cloud')
  })
})

describe('startSync', () => {
  it('PUTs the run, uploads each finished screen once, and marks the run done', async () => {
    const { createServer } = await import('node:http')
    const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { EventEmitter } = await import('node:events')
    const { PNG } = await import('pngjs')
    const { startSync } = await import('./sync.js')
    const { saveState } = await import('./state.js')

    const dir = mkdtempSync(join(tmpdir(), 'mushi-ux-sync-'))
    const png = PNG.sync.write(new PNG({ width: 4, height: 4 }))
    mkdirSync(join(dir, 'shots'))
    for (const f of ['b.png', 'a.png', 'd.png']) writeFileSync(join(dir, 'shots', f), png)
    saveState(dir, state)

    const calls: Array<{ method: string; url: string; body: string }> = []
    const server = createServer((req, res) => {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        calls.push({ method: req.method ?? '', url: req.url ?? '', body })
        res.setHeader('content-type', 'application/json')
        if (req.url?.startsWith('/upload/')) return res.end('{}')
        if (req.url?.endsWith('/uploads')) {
          const names = JSON.parse(body).names as string[]
          return res.end(JSON.stringify({ ok: true, data: { uploads: names.map((name) => ({ name, signedUrl: `http://127.0.0.1:${port}/upload/${name}` })) } }))
        }
        res.end(JSON.stringify({ ok: true, data: {} }))
      })
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const port = (server.address() as { port: number }).port
    try {
      const sync = startSync(dir, { apiKey: 'k', projectId: 'p1', endpoint: `http://127.0.0.1:${port}`, mode: 'local' }, new EventEmitter(), () => {})
      expect(await sync.finish()).toBeNull()
      const puts = calls.filter((c) => c.method === 'PUT' && c.url.startsWith('/v1/'))
      expect(puts.at(-1)?.url).toBe('/v1/admin/projects/p1/ux-runs/20261006-011207-qafu')
      const final = JSON.parse(puts.at(-1)?.body ?? '{}')
      expect(final.status).toBe('done')
      expect(final.surfaces[0].thumbs).toEqual({
        before: 'root-42099b/before-desktop.png',
        after: 'root-42099b/after-desktop.png',
        diff: 'root-42099b/diff-desktop.png',
      })
      expect(final.surfaces[0].iterations[0].shots).toEqual({ 'after-desktop': 'root-42099b/iter1-after-desktop.png', 'diff-desktop': 'root-42099b/iter1-diff-desktop.png' })
      // baseline, kept after + diff, and attempt 1's after + diff: each uploaded once
      expect(calls.filter((c) => c.url.startsWith('/upload/'))).toHaveLength(5)
    } finally {
      server.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('explains a key without console write access', async () => {
    const { createServer } = await import('node:http')
    const { mkdtempSync, rmSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { EventEmitter } = await import('node:events')
    const { startSync } = await import('./sync.js')
    const { saveState } = await import('./state.js')
    const dir = mkdtempSync(join(tmpdir(), 'mushi-ux-sync-'))
    saveState(dir, state)
    const server = createServer((_req, res) => {
      res.statusCode = 403
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ ok: false, error: { code: 'INSUFFICIENT_SCOPE', message: 'no' } }))
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const port = (server.address() as { port: number }).port
    try {
      const sync = startSync(dir, { apiKey: 'k', projectId: 'p1', endpoint: `http://127.0.0.1:${port}`, mode: 'local' }, new EventEmitter(), () => {})
      expect(await sync.finish()).toMatch(/Run `mushi login`/)
    } finally {
      server.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('syncProjectMismatch', () => {
  it('stops a sync that would land on another app’s project', async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { syncProjectMismatch, repoProjectId } = await import('./sync.js')
    const dir = mkdtempSync(join(tmpdir(), 'mushi-ux-proj-'))
    try {
      const cfg = { apiKey: 'k', projectId: '450e6ba8-cf2b-4841-bb38-08141e1ebe77', endpoint: 'x', mode: 'local' as const }
      expect(syncProjectMismatch(cfg, dir)).toBeNull()
      writeFileSync(join(dir, '.env.local'), 'SECRET=nope\nNEXT_PUBLIC_MUSHI_PROJECT_ID="542b34e0-019e-41fe-b900-7b637717bb86"\n')
      expect(repoProjectId(dir)).toBe('542b34e0-019e-41fe-b900-7b637717bb86')
      expect(syncProjectMismatch(cfg, dir)).toMatch(/reports to Mushi project 542b34e0.*login is for 450e6ba8/)
      expect(syncProjectMismatch({ ...cfg, projectId: '542b34e0-019e-41fe-b900-7b637717bb86' }, dir)).toBeNull()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
