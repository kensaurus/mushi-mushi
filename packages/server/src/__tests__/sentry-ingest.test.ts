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
}) {
  function table(name: string) {
    return {
      select: () => table(name),
      eq: () => table(name),
      insert: (row: Row) => {
        state.inserted.push({ table: name, row })
        return Promise.resolve({ error: null })
      },
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
