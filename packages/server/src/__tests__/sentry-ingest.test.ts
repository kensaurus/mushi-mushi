/**
 * FILE: sentry-ingest.test.ts
 * PURPOSE: Pin the Sentry error → Mushi report translation (the inbound half
 *          of the mediator loop). Pure helpers are tested directly; the
 *          ingest/dedup/reopen flow runs against a minimal chainable db stub.
 */

import { describe, it, expect, beforeEach } from 'vitest'

;(globalThis as typeof globalThis & { Deno?: { env: { get: (k: string) => string | undefined } } }).Deno ??= {
  env: { get: (key: string) => process.env[key] },
}

const mod = await import('../../supabase/functions/_shared/sentry-ingest.ts')

describe('mapSentryLevelToSeverity', () => {
  it('maps the Sentry level vocabulary onto Mushi severities', () => {
    expect(mod.mapSentryLevelToSeverity('fatal')).toBe('critical')
    expect(mod.mapSentryLevelToSeverity('error')).toBe('high')
    expect(mod.mapSentryLevelToSeverity('warning')).toBe('medium')
    expect(mod.mapSentryLevelToSeverity('info')).toBe('low')
    expect(mod.mapSentryLevelToSeverity(undefined)).toBe('low')
  })
})

describe('renderStackText', () => {
  it('renders type/value plus innermost-first frames, bounded to 10', () => {
    const frames = Array.from({ length: 14 }, (_, i) => ({
      filename: `src/file${i}.ts`,
      function: `fn${i}`,
      lineno: i + 1,
    }))
    const text = mod.renderStackText({
      values: [{ type: 'TypeError', value: 'x is not a function', stacktrace: { frames } }],
    })!
    const lines = text.split('\n')
    expect(lines[0]).toBe('TypeError: x is not a function')
    // Sentry frames are outermost→innermost; we show the last 10, reversed.
    expect(lines[1]).toBe('  at fn13 (src/file13.ts:14)')
    expect(lines).toHaveLength(11)
  })

  it('returns null with no exception', () => {
    expect(mod.renderStackText(undefined)).toBeNull()
    expect(mod.renderStackText({ values: [] })).toBeNull()
  })
})

// ── Chainable db stub ────────────────────────────────────────────────────────

interface Row {
  [k: string]: unknown
}

function makeDbStub(state: {
  links: Row[]
  reports: Row[]
  inserted: { table: string; row: Row }[]
  updated: { table: string; row: Row; id: string }[]
  deleted?: { table: string; id: string }[]
  /** Simulates a concurrent delivery: the link insert hits the unique index
   *  and this row becomes the link findLinkedReport sees. */
  raceWinner?: Row
}) {
  function table(name: string) {
    return {
      select: () => table(name),
      eq: () => table(name),
      insert: (row: Row) => {
        if (name === 'report_external_issues' && state.raceWinner) {
          state.links = [state.raceWinner]
          return Promise.resolve({ error: { code: '23505', message: 'duplicate key value violates unique constraint' } })
        }
        state.inserted.push({ table: name, row })
        return Promise.resolve({ error: null })
      },
      delete: () => ({
        eq: (_col: string, id: string) => {
          ;(state.deleted ??= []).push({ table: name, id })
          return Promise.resolve({ error: null })
        },
      }),
      update: (row: Row) => ({
        eq: (_col: string, id: string) => {
          state.updated.push({ table: name, row, id })
          return Promise.resolve({ error: null })
        },
      }),
      maybeSingle: () => {
        if (name === 'report_external_issues') {
          return Promise.resolve({ data: state.links[0] ?? null })
        }
        if (name === 'reports') {
          return Promise.resolve({ data: state.reports[0] ?? null })
        }
        return Promise.resolve({ data: null })
      },
    }
  }
  return { from: (name: string) => table(name) } as never
}

const EVENT = {
  event_id: 'evt-1',
  title: "TypeError: Cannot read properties of undefined (reading 'submit')",
  culprit: 'checkout/PaymentForm.tsx in handleSubmit',
  level: 'error',
  issue_id: '4501',
  web_url: 'https://sakuramoto.sentry.io/issues/4501/',
  request: { url: 'https://app.example.com/checkout' },
  tags: [['release', '1.4.2'], ['environment', 'production']] as Array<[string, string]>,
  exception: {
    values: [
      {
        type: 'TypeError',
        value: "Cannot read properties of undefined (reading 'submit')",
        stacktrace: { frames: [{ filename: 'PaymentForm.tsx', function: 'handleSubmit', lineno: 42 }] },
      },
    ],
  },
}

describe('ingestSentryError', () => {
  let state: Parameters<typeof makeDbStub>[0]
  let classified: string[]

  beforeEach(() => {
    state = { links: [], reports: [], inserted: [], updated: [] }
    classified = []
  })

  it('creates a report + external link and triggers classification', async () => {
    const result = await mod.ingestSentryError(makeDbStub(state), {
      projectId: 'proj-1',
      event: EVENT,
      issue: null,
      triggerClassification: (rid) => classified.push(rid),
    })
    expect(result.outcome).toBe('created')
    const report = state.inserted.find((i) => i.table === 'reports')!.row
    expect(report.category).toBe('bug')
    expect(report.severity).toBe('high')
    expect(report.sentry_release).toBe('1.4.2')
    expect(report.sentry_environment).toBe('production')
    expect(report.sentry_issue_url).toBe(EVENT.web_url)
    expect((report.custom_metadata as Row).source).toBe('sentry_webhook')
    expect((report.console_logs as Row[])[0].stack).toContain('handleSubmit')
    const link = state.inserted.find((i) => i.table === 'report_external_issues')!.row
    expect(link.system).toBe('sentry')
    expect(link.external_id).toBe('4501')
    expect(classified).toEqual([result.reportId])
  })

  it('dedups a repeat alert for an open linked report', async () => {
    state.links = [{ report_id: 'r-1' }]
    state.reports = [{ id: 'r-1', status: 'classified', regression_count: 0 }]
    const result = await mod.ingestSentryError(makeDbStub(state), {
      projectId: 'proj-1',
      event: EVENT,
      issue: null,
      triggerClassification: (rid) => classified.push(rid),
    })
    expect(result).toEqual({ outcome: 'deduped', reportId: 'r-1' })
    expect(state.inserted).toHaveLength(0)
    expect(classified).toHaveLength(0)
  })

  it('reopens a fixed report on regression instead of filing a duplicate', async () => {
    state.links = [{ report_id: 'r-1' }]
    state.reports = [{ id: 'r-1', status: 'fixed', regression_count: 1 }]
    const result = await mod.ingestSentryError(makeDbStub(state), {
      projectId: 'proj-1',
      event: EVENT,
      issue: null,
      triggerClassification: (rid) => classified.push(rid),
    })
    expect(result.outcome).toBe('reopened')
    const upd = state.updated.find((u) => u.table === 'reports')!
    expect(upd.row.status).toBe('reopened')
    expect(upd.row.regression_count).toBe(2)
    expect(state.inserted).toHaveLength(0)
  })

  it('drops its own report when a concurrent delivery linked the issue first', async () => {
    state.raceWinner = { report_id: 'r-win' }
    state.reports = [{ id: 'r-win', status: 'new', regression_count: 0 }]
    const result = await mod.ingestSentryError(makeDbStub(state), {
      projectId: 'proj-1',
      event: EVENT,
      issue: null,
      triggerClassification: (rid) => classified.push(rid),
    })
    expect(result).toEqual({ outcome: 'deduped', reportId: 'r-win' })
    const ours = state.inserted.find((i) => i.table === 'reports')!.row.id as string
    expect(state.deleted).toEqual([{ table: 'reports', id: ours }])
    // The orphan is never classified.
    expect(classified).toHaveLength(0)
  })

  it('ignores payloads with no title', async () => {
    const result = await mod.ingestSentryError(makeDbStub(state), {
      projectId: 'proj-1',
      event: null,
      issue: null,
      triggerClassification: () => {},
    })
    expect(result.outcome).toBe('ignored')
    expect(state.inserted).toHaveLength(0)
  })
})

describe('ingestSentryError — transient database outages are not filed', () => {
  // The extra shapes are the ones the 2026-10-14 pooler outage filed as reports.
  const POOLER =
    'upstream connect error or disconnect/reset before headers. retried and the latest reset reason: ' +
    'remote connection failure, transport failure reason: delayed connect error: 111'
  let state: Parameters<typeof makeDbStub>[0]
  let classified: string[]

  beforeEach(() => {
    state = { links: [], reports: [], inserted: [], updated: [] }
    classified = []
  })

  const ingest = (event: Parameters<typeof mod.ingestSentryError>[1]['event']) =>
    mod.ingestSentryError(makeDbStub(state), {
      projectId: 'proj-1',
      event,
      issue: null,
      triggerClassification: (rid) => classified.push(rid),
      intake: 'poll',
    })

  it('skips a log.error event whose extra carries the pooler reset (MUSHI-MUSHI-SERVER-22)', async () => {
    const result = await ingest({ title: 'open attempt scan failed', issue_id: '9001', extra: { error: POOLER } })
    expect(result.outcome).toBe('ignored')
    expect(state.inserted).toHaveLength(0)
    expect(classified).toHaveLength(0)
  })

  it('skips a PGRST002 schema-cache reload carried as a PostgREST object (MUSHI-MUSHI-SERVER-1M)', async () => {
    const result = await ingest({
      title: 'Failed to fetch qa_stories',
      issue_id: '9002',
      extra: {
        err: {
          code: 'PGRST002',
          details: null,
          hint: null,
          message: 'Could not query the database for the schema cache. Retrying.',
        },
      },
    })
    expect(result.outcome).toBe('ignored')
    expect(state.inserted).toHaveLength(0)
  })

  it('skips the hosted gateway body on a repo-binding lookup', async () => {
    const result = await ingest({
      title: 'Error: project_settings.github_repo_url lookup failed: Project not specified.',
      issue_id: '9010',
      extra: { message: 'project_settings.github_repo_url lookup failed: Project not specified.' },
    })
    expect(result.outcome).toBe('ignored')
    expect(state.inserted).toHaveLength(0)
  })

  it('still files a caller sentence that only resembles the gateway body', async () => {
    const result = await ingest({
      title: 'Error: Project not specified by the caller',
      issue_id: '9011',
    })
    expect(result.outcome).toBe('created')
  })

  it('skips a thrown error whose title is the pooler reset (MUSHI-MUSHI-SERVER-2S)', async () => {
    const result = await ingest({
      title: `Error: project_repos.repo_url lookup failed: ${POOLER}`,
      issue_id: '9003',
    })
    expect(result.outcome).toBe('ignored')
  })

  it('a webhook alert for a pooler reset is skipped too', async () => {
    const result = await mod.ingestSentryError(makeDbStub(state), {
      projectId: 'proj-1',
      event: { title: 'failed to load jobs', issue_id: '9006', extra: { err: POOLER } },
      issue: null,
      triggerClassification: () => {},
    })
    expect(result.outcome).toBe('ignored')
    expect(state.inserted).toHaveLength(0)
  })

  it('an operator import by hand still files it: they asked for that issue', async () => {
    const result = await mod.ingestSentryError(makeDbStub(state), {
      projectId: 'proj-1',
      event: { title: 'failed to load jobs', issue_id: '9007', extra: { err: POOLER } },
      issue: null,
      triggerClassification: () => {},
      intake: 'import',
    })
    expect(result.outcome).toBe('created')
  })

  it('skips a PGRST002 that carries only its code', async () => {
    const result = await ingest({ title: 'load failed', issue_id: '9008', extra: { err: { code: 'PGRST002', message: '' } } })
    expect(result.outcome).toBe('ignored')
  })

  it.each([
    'Error: read ECONNRESET',
    'Error: socket hang up',
    'Error: connection reset by peer',
  ])('still files a user-app network error from its own backend: %s', async (title) => {
    const result = await ingest({ title, issue_id: `9100-${title}` })
    expect(result.outcome).toBe('created')
  })

  it('still files a statement timeout: that is a slow query, a real bug', async () => {
    const result = await ingest({
      title: 'analyze job failed',
      issue_id: '9004',
      extra: { err: { code: '57014', message: 'canceling statement due to statement timeout' } },
    })
    expect(result.outcome).toBe('created')
  })

  it('still files a missing column, even though PostgREST says "schema cache"', async () => {
    const result = await ingest({
      title: 'reports update failed',
      issue_id: '9005',
      extra: { err: { code: 'PGRST204', message: "Could not find the 'foo' column of 'reports' in the schema cache" } },
    })
    expect(result.outcome).toBe('created')
  })
})

describe('ingestSentryError — import intake, extra, frames', () => {
  let state: Parameters<typeof makeDbStub>[0]

  beforeEach(() => {
    state = { links: [], reports: [], inserted: [], updated: [] }
  })

  it('a poll of a fixed issue that fired again reopens it, as an alert would (2D, 2026-10-09)', async () => {
    state.links = [{ report_id: 'r-1' }]
    state.reports = [{ id: 'r-1', status: 'fixed', regression_count: 0 }]
    const result = await mod.ingestSentryError(makeDbStub(state), {
      projectId: 'proj-1',
      event: EVENT,
      issue: null,
      triggerClassification: () => {},
      intake: 'poll',
    })
    expect(result).toEqual({ outcome: 'reopened', reportId: 'r-1' })
    const upd = state.updated.find((u) => u.table === 'reports')!
    expect(upd.row.status).toBe('reopened')
    expect(upd.row.regression_count).toBe(1)
  })

  it('a poll of an issue whose report is still open leaves it alone', async () => {
    state.links = [{ report_id: 'r-1' }]
    state.reports = [{ id: 'r-1', status: 'fixing', regression_count: 0 }]
    const result = await mod.ingestSentryError(makeDbStub(state), {
      projectId: 'proj-1',
      event: EVENT,
      issue: null,
      triggerClassification: () => {},
      intake: 'poll',
    })
    expect(result).toEqual({ outcome: 'linked', reportId: 'r-1' })
    expect(state.updated).toHaveLength(0)
    expect(state.inserted).toHaveLength(0)
  })

  it('an import of an already-linked fixed issue answers linked and never reopens it', async () => {
    state.links = [{ report_id: 'r-1' }]
    state.reports = [{ id: 'r-1', status: 'fixed', regression_count: 0 }]
    const result = await mod.ingestSentryError(makeDbStub(state), {
      projectId: 'proj-1',
      event: EVENT,
      issue: null,
      triggerClassification: () => {},
      intake: 'import',
    })
    expect(result).toEqual({ outcome: 'linked', reportId: 'r-1' })
    expect(state.updated).toHaveLength(0)
    expect(state.inserted).toHaveLength(0)
  })

  it('folds event extra into the description and stores frame paths + intake', async () => {
    await mod.ingestSentryError(makeDbStub(state), {
      projectId: 'proj-1',
      event: {
        ...EVENT,
        extra: { error: { message: 'JWT expired', code: 'PGRST301' }, logMessage: 'fetch_patterns_failed' },
        exception: {
          values: [
            {
              type: 'Error',
              value: '[object Object]',
              stacktrace: { frames: [{ filename: 'app:///stores/mistake-patterns.ts', lineno: 58, in_app: true }] },
            },
          ],
        },
      },
      issue: { id: '4501', shortId: 'GLOT-IT-C4' },
      triggerClassification: () => {},
      intake: 'import',
    })
    const report = state.inserted.find((i) => i.table === 'reports')!.row
    expect(report.description).toContain('Event extra:')
    expect(report.description).toContain('PGRST301')
    expect(report.description).toContain('logMessage: fetch_patterns_failed')
    const meta = report.custom_metadata as Row
    expect(meta.source).toBe('sentry_webhook')
    expect(meta.intake).toBe('import')
    expect(meta.sentryShortId).toBe('GLOT-IT-C4')
    expect(meta.sentryFrames).toEqual(['stores/mistake-patterns.ts'])
  })
})

describe('sentryLocationTags', () => {
  it('keeps the tags that locate a handled server error, never user or IP tags', () => {
    const tags: Array<[string, string]> = [
      ['path', '/api/v1/admin/inbox/stats'],
      ['method', 'GET'],
      ['error_type', 'db'],
      ['db_code', 'unknown'],
      ['user.email', 'someone@example.com'],
      ['user.ip', '13.112.64.109'],
      ['release', '1.4.2'],
    ]
    expect(mod.sentryLocationTags(tags)).toEqual({ path: '/api/v1/admin/inbox/stats', method: 'GET', error_type: 'db', db_code: 'unknown' })
    expect(mod.sentryLocationTags([['release', '1.4.2']])).toBeNull()
    expect(mod.sentryLocationTags(undefined)).toBeNull()
  })

  it('puts the route in the report so a fix agent can find the failing query (MUSHI-MUSHI-SERVER-2E)', async () => {
    const state: Parameters<typeof makeDbStub>[0] = { links: [], reports: [], inserted: [], updated: [] }
    await mod.ingestSentryError(makeDbStub(state), {
      projectId: 'proj-1',
      event: { ...EVENT, tags: [...EVENT.tags, ['path', '/api/v1/admin/inbox/stats'], ['method', 'GET'], ['user.ip', '13.112.64.109']] },
      issue: { id: '4502', shortId: 'MUSHI-MUSHI-SERVER-2E' },
      triggerClassification: () => {},
      intake: 'import',
    })
    const report = state.inserted.find((i) => i.table === 'reports')!.row
    expect(report.description).toContain('Where: path=/api/v1/admin/inbox/stats method=GET')
    expect(report.description).not.toContain('13.112.64.109')
    expect((report.custom_metadata as Record<string, unknown>).sentryLocation).toEqual({ path: '/api/v1/admin/inbox/stats', method: 'GET' })
  })
})

describe('formatSentryExtra', () => {
  it('bounds each value and the whole block', () => {
    const block = mod.formatSentryExtra({ a: 'x'.repeat(1000), b: null, c: 'short' }, 400)!
    expect(block.length).toBeLessThanOrEqual(401)
    expect(block).not.toContain('b:')
    expect(mod.formatSentryExtra(null)).toBeNull()
    expect(mod.formatSentryExtra({})).toBeNull()
  })
})
