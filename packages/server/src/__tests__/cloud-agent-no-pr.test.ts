/**
 * FILE: cloud-agent-no-pr.test.ts
 * PURPOSE: The no-PR verdict, on the opening lines of the six Cursor runs
 *          that ended without a PR on 2026-10-20, plus summaries that must
 *          stay "no verdict" so a live bug is never hidden as already fixed.
 */

import { describe, it, expect } from 'vitest'
import { classifyNoPrSummary, firstSentence, noPrErrorText } from '../../supabase/functions/_shared/cloud-agent-no-pr.ts'

const REAL = {
  yenyen: 'This crash is already fixed on `main`. I did not open a pull request.\n\nIt is the same Android failure as YEN-YEN-MOBILE-44.',
  useRef: 'The `useRef` crash is already gone on `main`. I did not open a pull request.',
  taxOffice: '`taxOfficeDisplayName` is already in scope on `main`. I did not open a pull request.',
  embedding: 'The $3/$12 figure is the backend catalog fallback, and the missing `ai_configs` row for `text-embedding-3-large` is already in the database. I did not open a pull request.\n\n`kensaurus/solo-boss-cloud_backend` is not readable with this token.',
  embeddingBackend: 'The invented $3/$12 rate for `text-embedding-3-large` is already fixed on `main`, so I did not open a pull request.',
  payout: 'The tsumagoi payout fee check is not in this repository, so I did not open a pull request. `needsHumanReview=true`.\n\n`GET /api/cron/integration-pull` runs in the backend. This checkout is the frontend.',
  chapter: 'The live Chapter 4 page is rendering the chapter. I did not open a pull request, because the "Couldn\'t load this chapter" fallback is not happening on the current deploy.',
}

describe('classifyNoPrSummary on real Cursor summaries', () => {
  it('reads "already fixed / gone / in scope on main" as already_fixed', () => {
    for (const s of [REAL.yenyen, REAL.useRef, REAL.taxOffice, REAL.embeddingBackend]) {
      expect(classifyNoPrSummary(s).category, s).toBe('already_fixed')
    }
  })

  it('reads "not in this repository / this checkout is the frontend" as wrong_repo', () => {
    expect(classifyNoPrSummary(REAL.payout).category).toBe('wrong_repo')
  })

  it('reads "not happening on the current deploy" as already_fixed', () => {
    expect(classifyNoPrSummary(REAL.chapter).category).toBe('already_fixed')
  })

  it('reads "loading correctly right now" and "could not find a defect" as nothing to change (second batch)', () => {
    expect(
      classifyNoPrSummary('The preface page is loading correctly right now, so I did not open a pull request.\n\nhttps://…').category,
    ).toBe('already_fixed')
    expect(
      classifyNoPrSummary(
        'The live site is serving these pages. I did not open a pull request because I could not find a defect that puts "Something went wrong" on them.',
      ).category,
    ).toBe('already_fixed')
  })

  it('skips "No pull request." to keep the reason, and keeps it on an unclassified run', () => {
    const v = classifyNoPrSummary(
      'No pull request. This Sentry event is a heuristic iOS watchdog termination with no stack, no breadcrumbs, and no measured memory reading.\n\n**needsHumanReview:** true',
    )
    expect(v.category).toBeNull()
    expect(noPrErrorText(v)).toBe(
      'Cloud agent finished without opening a pull request. Its notes: This Sentry event is a heuristic iOS watchdog termination with no stack, no breadcrumbs, and no measured memory reading.',
    )
  })

  it('keeps the first sentence, without backticks, as the reason', () => {
    expect(classifyNoPrSummary(REAL.yenyen).reason).toBe('This crash is already fixed on main.')
    expect(noPrErrorText(classifyNoPrSummary(REAL.payout))).toBe(
      'Agent says the code is in another repo: The tsumagoi payout fee check is not in this repository, so I did not open a pull request.',
    )
  })
})

describe('classifyNoPrSummary stays silent when unsure', () => {
  it('no summary, or a summary with no verdict, is no verdict', () => {
    expect(classifyNoPrSummary(null)).toEqual({ category: null, reason: null })
    expect(classifyNoPrSummary('   ')).toEqual({ category: null, reason: null })
    const v = classifyNoPrSummary('I ran out of time before finding the cause. The stack points at Settings.tsx.')
    expect(v.category).toBeNull()
    expect(noPrErrorText(v)).toBe(
      'Cloud agent finished without opening a pull request. Its notes: I ran out of time before finding the cause.',
    )
    expect(noPrErrorText(classifyNoPrSummary(null))).toBe('Cloud agent finished without opening a pull request.')
  })

  it('ignores a verdict phrase buried deep in the notes', () => {
    const long = `I could not find the cause. ${'Checked another file. '.repeat(40)} It may be already fixed upstream.`
    expect(classifyNoPrSummary(long).category).toBeNull()
  })

  it('does not read "fixed" in a plain description as a verdict', () => {
    expect(classifyNoPrSummary('The fixed header overlaps the button; I need a design decision first.').category).toBeNull()
  })
})

describe('firstSentence', () => {
  it('cuts long sentences with an ellipsis', () => {
    const s = firstSentence('word '.repeat(100), 50)
    expect(s.length).toBeLessThanOrEqual(50)
    expect(s.endsWith('…')).toBe(true)
  })
})
