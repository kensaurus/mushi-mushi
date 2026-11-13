import { describe, expect, it, vi } from 'vitest'
import type * as ConfigModule from '../config.js'
import { errorReply, okReply, runCli } from '../test-harness.js'
import { registerJourneysCommands } from './journeys.js'

vi.mock('../config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof ConfigModule>()
  return {
    ...actual,
    loadConfig: () => ({ apiKey: 'mushi_test_key_0123', endpoint: 'https://api.test/functions/v1/api', projectId: '11111111-2222-4333-8444-555555555555' }), // gitleaks:allow — fake key for the CLI test harness
  }
})

const PID = '11111111-2222-4333-8444-555555555555'

const scan = { id: 'scan-1', status: 'done', baseUrl: 'https://habit.app', pageCount: 12, error: null, createdAt: '2026-11-13T00:00:00Z', finishedAt: '2026-11-13T00:01:00Z' }

function journeys() {
  return {
    days: 30,
    liveUrl: 'https://habit.app',
    scan,
    mapScan: scan,
    map: {
      stats: { sessions: 40, pageViews: 120, pages: 9, avgPagesPerSession: 3, bounceRate: 0.25, sampled: false },
      score: 74,
      rootPath: '/',
      nodes: [],
      edges: [],
      flows: [{ pages: ['/', '/pricing', '/signup'], sessions: 11 }],
      findings: [
        { id: 'f1', kind: 'dead_end', severity: 'high', pages: ['/checkout'], title: 'People stop at /checkout', detail: '9 of 12 left here', suggestion: 'Add a clear next step', prompt: 'In this repo, open the /checkout page.\nAdd a next-step button.' },
        { id: 'f2', kind: 'orphan', severity: 'low', pages: ['/old-pricing'], title: 'Nothing links to /old-pricing', detail: 'Found by the scan', suggestion: 'Link it or remove it', prompt: 'Remove /old-pricing.' },
      ],
    },
  }
}

describe('mushi journeys', () => {
  it('reads the configured project for 30 days and prints the score, paths and findings', async () => {
    const run = await runCli(registerJourneysCommands, ['journeys'], () => okReply(journeys()))
    expect(run.calls[0]!.path).toBe(`/v1/admin/projects/${PID}/journeys?days=30`)
    expect(run.calls[0]!.method).toBe('GET')
    expect(run.stdout).toContain('score 74/100')
    expect(run.stdout).toContain('40 session(s)')
    expect(run.stdout).toContain('/ → /pricing → /signup')
    expect(run.stdout).toContain('People stop at /checkout')
    expect(run.stdout).toContain('Fix: Add a clear next step')
    expect(run.stdout).toContain('Nothing links to /old-pricing')
    expect(run.stdout).not.toContain('Add a next-step button')
  })

  it('filters by kind and prints each prompt with --prompts', async () => {
    const run = await runCli(registerJourneysCommands, ['journeys', '--days', '90', '--kind', 'dead_end', '--prompts'], () => okReply(journeys()))
    expect(run.calls[0]!.path).toBe(`/v1/admin/projects/${PID}/journeys?days=90`)
    expect(run.stdout).toContain('1 dead_end finding(s)')
    expect(run.stdout).toContain('Add a next-step button.')
    expect(run.stdout).not.toContain('/old-pricing')
  })

  it('refuses a window the route would read as 30', async () => {
    const run = await runCli(registerJourneysCommands, ['journeys', '--days', '14'], () => okReply(journeys()))
    expect(run.calls).toHaveLength(0)
    expect(run.error?.message).toContain('--days must be 7, 30 or 90')
  })

  it('refuses an unknown kind', async () => {
    const run = await runCli(registerJourneysCommands, ['journeys', '--kind', 'slow'], () => okReply(journeys()))
    expect(run.calls).toHaveLength(0)
    expect(run.error?.message).toContain('--kind must be one of')
  })

  it('says how to start when there is no scan yet', async () => {
    const data = { ...journeys(), scan: null, mapScan: null }
    const run = await runCli(registerJourneysCommands, ['journeys'], () => okReply(data))
    expect(run.stdout).toContain('No site scan yet. Run: mushi journeys scan')
  })
})

describe('mushi journeys record', () => {
  it('PUTs the window and sample rate', async () => {
    const run = await runCli(registerJourneysCommands, ['journeys', 'record', '--hours', '24', '--sample', '0.1'], () =>
      okReply({ recording: { until: '2026-11-14T00:00:00Z', sampleRate: 0.1 } }),
    )
    expect(run.calls).toHaveLength(1)
    expect(run.calls[0]!.method).toBe('PUT')
    expect(run.calls[0]!.path).toBe(`/v1/admin/projects/${PID}/journeys/recording`)
    expect(run.calls[0]!.body).toEqual({ hours: 24, sample_rate: 0.1 })
    expect(run.stdout).toContain('Recording 10% of visitors until')
  })

  it('--stop sends hours 0', async () => {
    const run = await runCli(registerJourneysCommands, ['journeys', 'record', '--stop'], () => okReply({ recording: { until: null, sampleRate: 0.1 } }))
    expect(run.calls[0]!.body).toEqual({ hours: 0 })
    expect(run.stdout).toContain('Recording is off')
  })

  it('refuses no window, both flags, and out-of-range values before calling the API', async () => {
    for (const argv of [
      ['journeys', 'record'],
      ['journeys', 'record', '--stop', '--hours', '5'],
      ['journeys', 'record', '--hours', '200'],
      ['journeys', 'record', '--hours', '2.5'],
      ['journeys', 'record', '--hours', '24', '--sample', '0'],
      ['journeys', 'record', '--hours', '24', '--sample', '1.5'],
    ]) {
      const run = await runCli(registerJourneysCommands, argv, () => okReply({}))
      expect(run.calls, argv.join(' ')).toHaveLength(0)
      expect(run.error?.code, argv.join(' ')).toBe('E_INVALID_INPUT')
    }
  })
})

describe('mushi journeys scan', () => {
  it('POSTs the scan with the given address', async () => {
    const run = await runCli(registerJourneysCommands, ['journeys', 'scan', '--url', 'https://habit.app'], () =>
      okReply({ scan: { ...scan, status: 'running', pageCount: 0, finishedAt: null } }),
    )
    expect(run.calls).toHaveLength(1)
    expect(run.calls[0]!.method).toBe('POST')
    expect(run.calls[0]!.path).toBe(`/v1/admin/projects/${PID}/journeys/scan`)
    expect(run.calls[0]!.body).toEqual({ base_url: 'https://habit.app' })
    expect(run.stdout).toContain('Scan started for https://habit.app [scan-1]')
  })

  it('sends no address when --url is omitted and shows the API error', async () => {
    const run = await runCli(registerJourneysCommands, ['journeys', 'scan'], () =>
      errorReply(429, 'SCAN_TOO_SOON', 'This app was scanned a moment ago. Scan again in 7 min.'),
    )
    expect(run.calls[0]!.body).toEqual({})
    expect(run.exitCode).not.toBe(0)
    expect(run.stderr).toContain('SCAN_TOO_SOON')
  })
})
