/**
 * Providers round 2 (2026-11-18): Balance / Incidents columns only once a row has a value, app
 * names instead of repo slugs, one scoped empty line on Spend, and plain-word History changes with
 * identical changes folded. Full-stack audit: per-check counts by severity that add up to the
 * header, and a check's description without its title again.
 */

import { describe, expect, it } from 'vitest'
import type { ProviderAccount } from './kensaurusOpsTypes'
import { groupHistory, makeAppNamer, plainChanges, providerColumns, spendEmptyLine, type HistoryRow } from './providersView'
import { checksLine, severityParts } from '../components/gates/GateFindingsSection'

const account = (id: string, status: Partial<NonNullable<ProviderAccount['status']>> | null = null): ProviderAccount =>
  ({ id, provider: 'openai', label: id, host_project: 'kenji', probe_kind: 'balance', secret_name: null, depends: [], thresholds: {}, enabled: true, is_test: false, updated_at: '', updated_by: '', status }) as unknown as ProviderAccount

describe('providers columns', () => {
  it('hides Balance and Incidents when no row has a value, and says so once', () => {
    const cols = providerColumns([account('a'), account('b')], new Map())
    expect(cols).toEqual({ balance: false, incidents: false, note: 'Balance: not checked on any account yet · no open incidents' })
  })

  it('keeps Incidents once one account has one open', () => {
    const cols = providerColumns([account('a'), account('b')], new Map([['b', { total: 1 }]]))
    expect(cols.incidents).toBe(true)
    expect(cols.note).toBe('Balance: not checked on any account yet')
  })
})

describe('app names', () => {
  it('names an ops slug as the console does, and keeps a slug no project matches', () => {
    const name = makeAppNamer([
      { project_name: 'lets-talk', project_slug: 'how-to-talk-to-girls' },
      { project_name: 'glot.it', project_slug: 'glot-it' },
    ])
    expect(name('how-to-talk-to-girls')).toBe('lets-talk')
    expect(name('Glot.it')).toBe('glot.it')
    expect(name('bento')).toBe('bento')
  })
})

describe('spend empty line', () => {
  it('says whose calls the tab counts', () => {
    expect(spendEmptyLine('24h')).toBe('No AI calls through your shared provider accounts in the last 24 hours.')
    expect(spendEmptyLine('30d')).toContain('30 days')
  })
})

describe('history in plain words', () => {
  const AT = '2026-11-18T03:00:00Z'
  const upd = (id: string, subject: string, before: string, after: string, field = 'params', actor = 'owner:2026-11-18'): HistoryRow => ({
    id,
    at: AT,
    actor,
    op: 'UPDATE',
    kind: 'route',
    subject,
    diff: [{ field, before, after }],
  })

  it('turns JSON params into one line per changed value', () => {
    const r = upd('r1', 'yen-yen › default › #2', '{"thinking":{"type":"disabled"}}', '{"effort":"low","thinking":{"type":"disabled"}}')
    expect(plainChanges(r)).toEqual(['effort: low added'])
    expect(plainChanges(upd('r2', 's', '{"a":1,"b":2}', '{"a":3}'))).toEqual(['a: 1 → 3', 'b: 2 removed'])
    expect(plainChanges(upd('r3', 's', 'false', 'true', 'enabled'))).toEqual(['turned on'])
    expect(plainChanges(upd('r4', 's', 'gpt-6', 'gpt-6-luna', 'model'))).toEqual(['model: gpt-6 → gpt-6-luna'])
  })

  it('folds the same change by one actor on several routes into one row', () => {
    const p = (id: string, subject: string) => upd(id, subject, '{"thinking":{"type":"disabled"}}', '{"effort":"low","thinking":{"type":"disabled"}}')
    const items = groupHistory([p('r1', 'a'), p('r2', 'b'), p('r3', 'c'), upd('r4', 'd', 'false', 'true', 'enabled', 'console:smoke')])
    expect(items.map((i) => i.type)).toEqual(['same', 'row'])
    const same = items[0]
    expect(same.type === 'same' && same.rows.map((r) => r.subject)).toEqual(['a', 'b', 'c'])
    expect(same.type === 'same' && same.changes).toEqual(['effort: low added'])
  })
})

describe('full-stack audit counts', () => {
  it('names a check’s open findings by severity, so the cards add up to the header', () => {
    expect(severityParts([{ severity: 'error' }, { severity: 'warn' }, { severity: 'info' }, { severity: null }])).toBe('1 error · 1 warning · 2 notes')
    expect(severityParts([{ severity: 'warn' }, { severity: 'warn' }, { severity: 'warn' }])).toBe('3 warnings')
    expect(severityParts([])).toBe('')
  })

  it('drops the title a check’s description repeats', () => {
    expect(checksLine('App hole checks', 'App hole checks, daily (04:05 UTC): store listings, domains.')).toBe('Daily (04:05 UTC): store listings, domains.')
    expect(checksLine('Mushi Mushi setup checks', 'Mushi Mushi setup: spend caps, keys and connections.')).toBe('Spend caps, keys and connections.')
    expect(checksLine('App hole checks (from your CI)', 'App hole checks pushed from your CI.')).toBe('App hole checks pushed from your CI.')
    expect(checksLine('Dead handlers', 'Buttons and links whose handler does nothing.')).toBe('Buttons and links whose handler does nothing.')
  })
})
