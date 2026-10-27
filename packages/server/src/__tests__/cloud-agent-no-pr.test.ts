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

describe('classifyNoPrSummary on the 2026-10-20 runs still filed as API errors (2026-10-23)', () => {
  it('reads a backlog row the agent left unchanged, or one waiting on the owner, as needs_human', () => {
    const owner = [
      'I left BL-040 unchanged because it needs your next store-version bump: `scripts/setup-native-auth.mjs` is an OTA native-fingerprint input.',
      'BL-041 needs a bundled Android APK cold start on a device, so I changed nothing and did not open a pull request.',
      'BL-069 needs an iPad Air (M3) Instruments profile of cold start and Home: YEN-YEN-MOBILE-45 has no stack or breadcrumbs, so I changed nothing.',
      "BL-264 stays open because closing it requires an owner sign-off to defer Supabase off `/reserve`'s eager JavaScript graph.",
      'BL-034 stays deferred: choosing Capacitor Secure Storage over the Supabase JS session default is a product decision that also needs a device, so I changed nothing.',
      'BL-780’s migrations are already recorded as live; what is left is a real-yen test on each payment rail, which need the owner’s money and device, so I changed nothing.',
      "This needs the brand owner's PayPay for Business account: add a sub-user and turn on payment mail.",
      'BL-041 still has to wait for the next store release: changing it now would block every over-the-air update.',
      'BL-074 stays open until the owner buys and binds 施設賠償責任保険. ADR 0032 already withholds any venue-coverage claim, so I left the code and docs unchanged.',
      'BL-800 stays with the owner: the camp list still omits Tsumagoi Work&Camp, so I changed nothing.',
      'I changed nothing: #4 and #6 were already closed on 2026-10-14, while #1 still targets Actions majors, so closing or merging them is an owner decision on those breaking upgrades.',
      'BL-511 still needs you: production `payment_deadline_workflow_enabled` is false, so I changed nothing.',
      'BL-055 needs an owner product decision before any code change: lucky drops are already on Hold, so I changed nothing and did not open a pull request.',
      'BL-271 needs Kenji’s signed-in Reddit session: this environment is blocked by Reddit and has no stored login, so I changed nothing and did not open a pull request.',
    ]
    for (const s of owner) expect(classifyNoPrSummary(s).category, s).toBe('needs_human')
  })

  it('reads the other verdicts in that batch', () => {
    const cases: Array<[string, string]> = [
      ['I left the code unchanged: BL-1112 is a books posting in the owner’s private `solo-boss-cloud_backend`, which this tsumagoi checkout cannot read or change.', 'wrong_repo'],
      ['No pull request. `paymentRouteFor` and `localReturnEfiled` are not in this frontend repo, so a change here cannot fix the route.', 'wrong_repo'],
      ['The live Tutor page is not showing that error screen, so I did not open a pull request.', 'already_fixed'],
      ['All 25 reported pages render their main content again. I did not open a pull request, because I could not find a code defect that still blanks them.', 'already_fixed'],
      ['I did not open a pull request. On current `main`, nothing uses `canvasRef` without declaring it, so there is no code change that would fix this report.', 'not_actionable'],
    ]
    for (const [summary, category] of cases) expect(classifyNoPrSummary(summary).category, summary).toBe(category)
  })

  it('does not settle a code fix that only mentions a backlog row', () => {
    expect(classifyNoPrSummary('BL-212 is the crash in Settings.tsx; the null guard was missing, so I could not finish the test.').category).toBeNull()
    expect(classifyNoPrSummary('The dialog stays open after Save because the handler never resolves.').category).toBeNull()
  })
})

describe('classifyNoPrSummary reads the declared verdict line first', () => {
  it('takes `Mushi verdict:` from the first line and the next sentence as the reason', () => {
    const v = classifyNoPrSummary('Mushi verdict: needs_human\n\nBL-586 needs a paid re-render or an owner photo.\n\nDetails…')
    expect(v).toEqual({ category: 'needs_human', reason: 'BL-586 needs a paid re-render or an owner photo.' })
    expect(classifyNoPrSummary('**Mushi verdict:** `wrong_repo` — the fee check is in the backend.').category).toBe('wrong_repo')
    expect(classifyNoPrSummary('Mushi verdict: already_fixed').reason).toBe('already_fixed')
  })

  it('beats a phrase that would read otherwise, and ignores a verdict line deep in the notes', () => {
    expect(classifyNoPrSummary('Mushi verdict: not_actionable\nThe live page is not blank, but the event has no route.').category).toBe('not_actionable')
    const deep = `I could not find the cause. ${'Checked another file. '.repeat(20)}\nMushi verdict: already_fixed`
    expect(classifyNoPrSummary(deep).category).toBeNull()
  })

  it('ignores an unknown verdict word', () => {
    expect(classifyNoPrSummary('Mushi verdict: maybe\nI ran out of time.').category).toBeNull()
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

  it('reads the verdict from the opening paragraph, not from a "What I ruled out" section (2026-10-21)', () => {
    const summary = [
      "I didn't find a confirmed root cause, so I haven't made any changes or opened a pull request. The evidence fits at least two explanations.",
      '**What I ruled out**\n- **A false alarm from the watchdog itself:** That was the old cause of this Sentry issue, and it\'s already fixed.',
    ].join('\n\n')
    expect(classifyNoPrSummary(summary).category).toBeNull()
    // The same opening with the review flag is a request for a person.
    expect(classifyNoPrSummary(summary.replace('two explanations.', 'two explanations. needsHumanReview=true.')).category).toBe('needs_human')
  })

  it('skips a filler-only opening paragraph and reads the next one', () => {
    expect(classifyNoPrSummary('No pull request.\n\nThis crash is already fixed on `main`.').category).toBe('already_fixed')
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
