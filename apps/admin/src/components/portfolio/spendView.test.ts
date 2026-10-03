import { describe, expect, it } from 'vitest'
import { billsBreakdown, importSummary, ledgerCell, ledgerTotal, removalSummary, supabaseUsage } from './spendView'
import { ratingLabel, pullSummary } from './storeReviewsView'

describe('ledgerCell', () => {
  it('never shows a failed read as $0', () => {
    expect(ledgerCell({ state: 'error', usd: null, detail: 'CI runs could not be read.' })).toEqual({ text: "Couldn't read", tone: 'danger', title: 'CI runs could not be read.' })
    expect(ledgerCell({ state: 'not_connected', usd: null, detail: 'Import a bill.' })).toEqual({ text: 'Not connected', tone: 'muted', title: 'Import a bill.' })
    expect(ledgerCell({ state: 'ok', usd: 0, detail: null })).toEqual({ text: '$0.00', tone: 'amount', title: undefined })
  })

  it('marks an incomplete total as a floor', () => {
    expect(ledgerTotal({ totalUsd: 12.5, complete: false }).text).toBe('$12.50+')
    expect(ledgerTotal({ totalUsd: 12.5, complete: true })).toEqual({ text: '$12.50', tone: null, title: undefined })
  })

  it('breaks bills down by vendor and lists Supabase usage', () => {
    expect(billsBreakdown({ bills: { state: 'ok', usd: 23.1, detail: null, byVendor: [{ vendor: 'vercel', usd: 20 }, { vendor: 'aws', usd: 3.1 }] } })).toBe('Vercel $20.00 · AWS $3.10')
    expect(supabaseUsage({ supabase: { state: 'ok', usd: 9, detail: 'From imported bills.', usage: [{ service: 'Egress', unit: 'GB', quantity: 1200 }] } })).toBe('1,200 GB Egress')
    expect(supabaseUsage({ supabase: { state: 'not_connected', usd: null, detail: 'Import a Supabase CSV.', usage: [] } })).toBe('Import a Supabase CSV.')
  })

  it('summarises an import with what was skipped and why', () => {
    expect(importSummary({ rowsImported: 3, rowsSkipped: 1, totalUsd: 7.5, periodStart: '2026-10-01', periodEnd: '2026-10-02', unmatchedApps: ['other-app'], skipReasons: ['line 4: the date is not YYYY-MM-DD'] }))
      .toBe('Imported 3 rows ($7.50) for 2026-10-01 to 2026-10-02. Skipped 1. No app named: other-app. line 4: the date is not YYYY-MM-DD')
  })

  it('says what removing an import did, including when nothing changed', () => {
    expect(removalSummary({ rowsRemoved: 0, rowsRestored: 0, restoredFrom: 0 }))
      .toBe('Import removed. The ledger did not change: a later import had already replaced all of its rows.')
    expect(removalSummary({ rowsRemoved: 3, rowsRestored: 0, restoredFrom: 0 })).toBe('Import removed. 3 rows left the ledger.')
    expect(removalSummary({ rowsRemoved: 0, rowsRestored: 1, restoredFrom: 1 })).toBe('Import removed. 1 row went back to the earlier import that had them.')
    expect(removalSummary({ rowsRemoved: 1, rowsRestored: 4, restoredFrom: 2 })).toBe('Import removed. 1 row left the ledger. 4 rows went back to 2 earlier imports that had them.')
  })
})

describe('store review view helpers', () => {
  it('labels the star threshold', () => {
    expect([1, 2, 4, 5].map(ratingLabel)).toEqual(['1 star', '1–2 stars', '1–4 stars', 'any rating'])
  })

  it('names a store that failed instead of folding it into zero', () => {
    expect(pullSummary({
      status: 'partial',
      filed: 1,
      stores: [
        { store: 'app_store', appId: '1', status: 'error', fetched: 0, newReviews: 0, filed: 0, detail: 'App Store Connect rejected the credential.' },
        { store: 'play', appId: 'com.x', status: 'ok', fetched: 3, newReviews: 2, filed: 1, detail: null },
      ],
    })).toBe('1 new report filed. · App Store: App Store Connect rejected the credential. · Google Play: 2 new reviews, 1 filed')
    expect(pullSummary({ status: 'not_connected', filed: 0, stores: [] })).toMatch(/No App Store Connect/)
  })
})
