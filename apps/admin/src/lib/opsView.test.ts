import { describe, expect, it } from 'vitest'
import { buildCoverageRows, freshness, opsAppName, needsLookView, nestThreads, paymentsToday, slackChipShown, slackState, splitBodyCta, splitOpsColumns } from './opsView'
import type { OpsCoverageResponse, OpsEvent } from './opsTypes'

const NOW = Date.parse('2026-11-17T05:00:00Z')

const ev = (over: Partial<OpsEvent>): OpsEvent => ({
  id: 'e',
  organization_id: 'o',
  project_id: 'p1',
  category: 'alerts',
  severity: 'urgent',
  kind: 'deploy.failed',
  title: 't',
  body: null,
  facts: [],
  url: null,
  amount_minor: null,
  currency: null,
  thread_key: null,
  parent_id: null,
  occurred_at: '2026-11-17T04:00:00Z',
  source: 'app',
  slack_channel: null,
  slack_ts: null,
  slack_error: null,
  acked_by: null,
  acked_at: null,
  ...over,
})

describe('freshness', () => {
  it('darker and a fuller shape the more recent; hatched for never', () => {
    expect(freshness('2026-11-17T04:30:00Z', NOW)).toMatchObject({ bucket: 'hour', glyph: '●', className: 'ci-heat-6', label: '30m ago' })
    expect(freshness('2026-11-16T10:00:00Z', NOW)).toMatchObject({ bucket: 'day', glyph: '●' })
    expect(freshness('2026-11-13T10:00:00Z', NOW)).toMatchObject({ bucket: 'week', glyph: '◐', className: 'ci-heat-2' })
    expect(freshness('2026-10-01T10:00:00Z', NOW)).toMatchObject({ bucket: 'old', glyph: '○' })
    expect(freshness(null, NOW)).toMatchObject({ bucket: 'never', glyph: '–', className: 'ci-cell-0 ci-nodata', label: 'never' })
  })
})

describe('buildCoverageRows', () => {
  it('puts apps that never sent an event first, and marks muted apps', () => {
    const data: OpsCoverageResponse = {
      apps: [
        { id: 'p1', name: 'Glot.it', slug: 'glot-it', icon_url: null },
        { id: 'p2', name: 'yen-yen', slug: 'yen-yen', icon_url: null },
      ],
      coverage: [
        { project_id: 'p1', category: 'payments', last_at: '2026-11-17T04:00:00Z', count_7d: 3 },
        { project_id: 'p2', category: 'bugs', last_at: '2026-11-17T04:00:00Z', count_7d: 9 },
      ],
      today: { payments: {}, releases: 0, openAlerts: 0, since: '' },
      mutes: [{ project_id: 'p1', until: '2026-11-17T09:00:00Z' }],
      slack: { enabled: true },
    }
    const rows = buildCoverageRows(data, NOW)
    expect(rows.map((r) => [r.app.id, r.silent])).toEqual([
      ['p2', true],
      ['p1', false],
    ])
    expect(rows[1].mutedUntil).toBe('2026-11-17T09:00:00Z')
    expect(rows[1].cells.find((c) => c.column === 'payments')).toMatchObject({ count7d: 3 })
  })

  // Round 3: the public demo app gets no row, and names keep their own case.
  it('leaves out the demo app and keeps the app name as written', () => {
    const data: OpsCoverageResponse = {
      apps: [
        { id: 'p1', name: 'Help Her Take Photo', slug: 'hhtp', icon_url: null },
        { id: 'd', name: 'Mushi demo (sample data)', slug: 'mushi-demo', icon_url: null },
      ],
      coverage: [],
      today: { payments: {}, releases: 0, openAlerts: 0, since: '' },
      mutes: [],
      slack: { enabled: true },
    }
    const rows = buildCoverageRows(data, NOW)
    expect(rows.map((r) => r.app.id)).toEqual(['p1'])
    expect(opsAppName(rows[0].app)).toBe('Help Her Take Photo')
  })
})

describe('nestThreads', () => {
  it('nests replies under the parent on the page, oldest reply first', () => {
    const parent = ev({ id: 'a', occurred_at: '2026-11-17T01:00:00Z' })
    const r2 = ev({ id: 'c', parent_id: 'a', severity: 'resolved', occurred_at: '2026-11-17T03:00:00Z' })
    const r1 = ev({ id: 'b', parent_id: 'a', severity: 'warn', occurred_at: '2026-11-17T02:00:00Z' })
    const orphan = ev({ id: 'd', parent_id: 'gone' })
    const threads = nestThreads([r2, orphan, r1, parent])
    expect(threads.map((t) => [t.event.id, t.replies.map((r) => r.id)])).toEqual([
      ['d', []],
      ['a', ['b', 'c']],
    ])
  })
})

describe('slackState and money', () => {
  it('names each Slack state with a shape', () => {
    expect(slackState({ slack_ts: '1.1', slack_channel: 'C1', slack_error: null })).toMatchObject({ glyph: '✓', label: 'In Slack' })
    expect(slackState({ slack_ts: null, slack_channel: 'C1', slack_error: 'channel_not_found' })).toMatchObject({ glyph: '✕', detail: 'channel_not_found' })
    expect(slackState({ slack_ts: null, slack_channel: null, slack_error: 'muted until 2026-11-18 05:00 UTC' })).toMatchObject({ label: 'Muted' })
    expect(slackState({ slack_ts: null, slack_channel: null, slack_error: null })).toMatchObject({ glyph: '–', label: 'Stored only' })
  })
  it('sums today per currency', () => {
    expect(paymentsToday({ JPY: 12000, USD: 4000 })).toBe('¥12,000 · $40.00')
    expect(paymentsToday({})).toBe('none yet')
  })
})

describe('needsLookView', () => {
  it('splits failures from warnings, worst first, and its count is exactly the rows listed', () => {
    const events = [
      ev({ id: 'w', severity: 'warn', title: 'Error: Word not found', occurred_at: '2026-11-17T04:40:00Z' }),
      ev({ id: 'u1', category: 'releases', title: 'Production deploy failed', occurred_at: '2026-11-17T04:30:00Z' }),
      ev({ id: 'u2', category: 'releases', title: 'Release failed', occurred_at: '2026-11-17T03:30:00Z' }),
      ev({ id: 'acked', acked_at: '2026-11-17T04:45:00Z' }),
      ev({ id: 'closed', thread_key: 'k', occurred_at: '2026-11-17T01:00:00Z' }),
      ev({ id: 'fix', parent_id: 'closed', severity: 'resolved', occurred_at: '2026-11-17T02:00:00Z' }),
      ev({ id: 'i', severity: 'info' }),
    ]
    const view = needsLookView(events)
    expect(view.failures.map((i) => i.thread.event.id)).toEqual(['u1', 'u2'])
    expect(view.warnings.map((i) => i.thread.event.id)).toEqual(['w'])
    expect(view.count).toBe(view.failures.length + view.warnings.length)
    expect(view.count).toBe(3)
  })
})

describe('splitOpsColumns', () => {
  const rows = (cats: string[]) =>
    buildCoverageRows(
      {
        apps: [{ id: 'p1', name: 'a', slug: null, icon_url: null }],
        coverage: cats.map((c) => ({ project_id: 'p1', category: c as 'releases', last_at: '2026-11-17T04:00:00Z', count_7d: 1 })),
        today: { payments: {}, releases: 0, openAlerts: 0, since: '' },
        mutes: [],
        slack: { enabled: true },
      },
      NOW,
    )
  it('hides a column no app has sent, and keeps the grid when nothing has data', () => {
    expect(splitOpsColumns(rows(['releases', 'bugs']))).toEqual({ shown: ['releases', 'bugs'], empty: ['payments', 'alerts'] })
    expect(splitOpsColumns(rows([])).empty).toEqual([])
    expect(splitOpsColumns(rows([])).shown).toHaveLength(4)
  })
})

describe('splitBodyCta and slackChipShown', () => {
  it('turns a closing "Open the run…" sentence into a link only when there is a URL', () => {
    expect(splitBodyCta('main failed at build. Open the run to see which step failed.', 'https://x')).toEqual({ text: 'main failed at build.', cta: 'Open the run to see which step failed' })
    expect(splitBodyCta('Open the run to see which step failed.', 'https://x')).toEqual({ text: null, cta: 'Open the run to see which step failed' })
    expect(splitBodyCta('Open the run to see which step failed.', null)).toEqual({ text: 'Open the run to see which step failed.', cta: null })
    expect(splitBodyCta('Plain body.', 'https://x')).toEqual({ text: 'Plain body.', cta: null })
  })
  it('draws the Slack chip only when it adds something', () => {
    const ok = slackState({ slack_ts: '1', slack_channel: 'C', slack_error: null })
    const stored = slackState({ slack_ts: null, slack_channel: null, slack_error: null })
    const failed = slackState({ slack_ts: null, slack_channel: 'C', slack_error: 'channel_not_found' })
    expect(slackChipShown(ok, true)).toBe(false)
    expect(slackChipShown(stored, false)).toBe(false)
    expect(slackChipShown(stored, true)).toBe(true)
    expect(slackChipShown(failed, false)).toBe(true)
  })
})
