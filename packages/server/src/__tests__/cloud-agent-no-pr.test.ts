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

  it('skips "No pull request." to keep the reason, and reads a stackless watchdog event as not_actionable', () => {
    const v = classifyNoPrSummary(
      'No pull request. This Sentry event is a heuristic iOS watchdog termination with no stack, no breadcrumbs, and no measured memory reading.\n\n**needsHumanReview:** true',
    )
    expect(v.category).toBe('not_actionable')
    expect(noPrErrorText(v)).toBe(
      'Agent found nothing it can tie to code: This Sentry event is a heuristic iOS watchdog termination with no stack, no breadcrumbs, and no measured memory reading.',
    )
  })

  it('reads the third batch (2026-10-20 afternoon), filed as API errors before', () => {
    const cases: Array<[string, string]> = [
      ['handleFlowInit is already defined in the same function that passes it to React Flow, so I did not open a pull request.', 'already_fixed'],
      ['The live page is not blank, so I did not open a pull request.', 'already_fixed'],
      ['The reported TypeError: network error is already dropped in production, and the event payload is too thin to show a remaining defect.', 'already_fixed'],
      ['The live /security page is not stuck.', 'already_fixed'],
      ['The six pages render their content on the live site right now.', 'already_fixed'],
      ['The live shop page is rendering its catalog.', 'already_fixed'],
      ['The $3/$12 figure is the backend catalog fallback, and the missing ai_configs row for text-embedding-3-large is already in the database.', 'already_fixed'],
      ['The report is a real Postgres statement timeout (57014), and the event does not say which query was cancelled.', 'not_actionable'],
      ["The log line comes from Firecrawl's change-monitor judge, not from this repo, so I did not open a pull request.", 'not_actionable'],
      ['BL-175 still needs a product decision: the plan forbids flipping SPEND_CAP_ENFORCEMENT_MODE off observe.', 'needs_human'],
      ['`needsHumanReview=true`.', 'needs_human'],
    ]
    for (const [summary, category] of cases) expect(classifyNoPrSummary(summary).category, summary).toBe(category)
    // A bare review flag is not a reason; the sentence after it is.
    expect(classifyNoPrSummary("needsHumanReview=true. BL-455 needs the owner's Stripe account, so I changed nothing.").reason).toBe(
      "BL-455 needs the owner's Stripe account, so I changed nothing.",
    )
    expect(noPrErrorText(classifyNoPrSummary(cases[9][0]))).toBe(
      'Agent says this needs a person: BL-175 still needs a product decision: the plan forbids flipping SPEND_CAP_ENFORCEMENT_MODE off observe.',
    )
  })

  it('still files a ledger-bypass explanation with no verdict phrase as no verdict', () => {
    expect(classifyNoPrSummary('SBC-BE-78 is the S-0 page firing on a registered ledger bypass, not an unsanctioned write.').category).toBeNull()
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

  it('does not read "fixed" in a plain description as already fixed', () => {
    expect(classifyNoPrSummary('The fixed header overlaps the button.').category).toBeNull()
    // The decision it asks for is the verdict, not the word "fixed".
    expect(classifyNoPrSummary('The fixed header overlaps the button; I need a design decision first.').category).toBe('needs_human')
  })
})

describe('firstSentence', () => {
  it('cuts long sentences with an ellipsis', () => {
    const s = firstSentence('word '.repeat(100), 50)
    expect(s.length).toBeLessThanOrEqual(50)
    expect(s.endsWith('…')).toBe(true)
  })
})
