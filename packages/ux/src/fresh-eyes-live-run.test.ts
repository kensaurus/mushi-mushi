// SPDX-License-Identifier: MIT
/**
 * What Mushi's first live fresh-eyes run (2026-10-28) got wrong about the
 * site, as pure rules:
 *
 * - the model read only the docs sidebar (the snapshot was cut at 8,000
 *   characters and the sidebar comes first), so main content now comes first;
 * - an sr-only "Skip to content" was offered as an action, so controls a mouse
 *   user cannot see are left out;
 * - "only a menu, nothing visible" was filed although the article was there;
 * - every step waited the full 20 s for two pulsing 6 px dots;
 * - a capped wait was reported as the app's time;
 * - a run with an account ran out of its 30 steps on "Name your project";
 * - the minted account's id was not in the log.
 */

import { describe, expect, it } from 'vitest'
import { contentReady, type LoadingMarks } from './capture.js'
import { agreedOpinions, appWaitCapped, composeSnapshot, contradictedOpinion, dropSnapshotNodes, redact, summarize, ttfvOf, type FreshEyesSession } from './fresh-eyes.js'
import { runSnapshot, timelineMarkdown } from './fresh-eyes-report.js'
import { stepsFor } from './fresh-eyes-request.js'

const sidebar = Array.from({ length: 400 }, (_, i) => `  - listitem:\n    - link "Docs page number ${i}"`).join('\n')
const article = '- heading "Sample diagnosis" [level=1]\n- paragraph: Why it broke. The Save handler never awaited the request.\n- button "Copy fix prompt"'
const body = `- link "Skip to Content"\n- navigation "Docs":\n  - list:\n${sidebar}\n- main:\n  ${article.split('\n').join('\n  ')}`

describe('the screen the model reads', () => {
  it('puts the main content first, so a long sidebar cannot push the article out', () => {
    // The old cut: the first 8,000 characters of the body are all sidebar.
    expect(body.slice(0, 8000)).not.toContain('Sample diagnosis')
    const snap = composeSnapshot({ main: article, body, hidden: [] })
    expect(snap.length).toBeLessThanOrEqual(8000)
    expect(snap.startsWith('Main content:\n- heading "Sample diagnosis"')).toBe(true)
    expect(snap).toContain('Copy fix prompt')
    // The navigation follows, so the visitor can still move on.
    expect(snap).toContain('The rest of the page (navigation, header, footer):')
    expect(snap).toContain('Docs page number 0')
    // The main content is not repeated inside the rest.
    expect(snap.match(/Sample diagnosis/g)).toHaveLength(1)
  })

  it('keeps room for the navigation when the main content alone is longer than the budget', () => {
    const longMain = Array.from({ length: 600 }, (_, i) => `- paragraph: line ${i} of the article`).join('\n')
    const snap = composeSnapshot({ main: longMain, body, hidden: [] })
    expect(snap.length).toBeLessThanOrEqual(8000)
    expect(snap).toContain('line 0 of the article')
    expect(snap).toContain('Docs page number 0')
  })

  it('leaves out controls a mouse user cannot see, with what is under them', () => {
    const snap = composeSnapshot({ main: null, body, hidden: ['Skip to Content'] })
    expect(snap).not.toContain('Skip to Content')
    expect(dropSnapshotNodes('- list:\n  - link "A":\n    - img\n  - link "B"', (l) => l.includes('"A"'))).toBe('- list:\n  - link "B"')
  })

  it('is the plain body, cut, on a page with no main', () => {
    expect(composeSnapshot({ main: null, body: '- heading "Hi"', hidden: [] })).toBe('- heading "Hi"')
  })
})

describe('opinions the page contradicts', () => {
  const session = (index: number, mainChars: number): Pick<FreshEyesSession, 'index' | 'opinions'> => ({
    index,
    opinions: [{ category: 'confusing', why: 'The page shows only a long docs menu, no diagnosis is visible.', screen: '/docs/demo/diagnosis', step: 2, mainChars }],
  })

  it('never files "nothing visible" or "only a menu" over a page whose main content has text', () => {
    expect(contradictedOpinion({ why: 'Only a menu here, nothing on the screen to read', mainChars: 2400 })).toBe(true)
    expect(contradictedOpinion({ why: 'The page is empty', mainChars: 2400 })).toBe(true)
    expect(agreedOpinions([session(1, 2400), session(2, 2400)], { goal: 'g', hasAccount: false })).toEqual([])
  })

  it('still files it when the page really shows nearly nothing, and leaves other opinions alone', () => {
    expect(agreedOpinions([session(1, 30), session(2, 30)], { goal: 'g', hasAccount: false })).toHaveLength(1)
    expect(contradictedOpinion({ why: 'Too many links, I could not tell which one shows the example', mainChars: 2400 })).toBe(false)
  })
})

describe('waiting for the content', () => {
  const marks = (over: Partial<LoadingMarks> = {}): LoadingMarks => ({ viewport: { width: 1280, height: 800 }, busy: [], skeletons: [], pulses: [], textLength: 900, ...over })

  it('a pulsing 6 px dot (a notification badge) is decoration: the page is ready', () => {
    expect(contentReady(marks({ pulses: [{ width: 6, height: 6 }, { width: 6, height: 6 }] }))).toBe(true)
  })

  it('a full-width skeleton, a pulsing block and a splash spinner still hold the page', () => {
    expect(contentReady(marks({ skeletons: [{ width: 1200, height: 24 }] }))).toBe(false)
    expect(contentReady(marks({ pulses: [{ width: 600, height: 120 }] }))).toBe(false)
    expect(contentReady(marks({ busy: [{ width: 48, height: 48 }] }))).toBe(false)
    expect(contentReady(marks({ textLength: 10 }))).toBe(false)
  })
})

const step = (n: number, over: Partial<FreshEyesSession['steps'][number]> = {}): FreshEyesSession['steps'][number] => ({ n, action: `step ${n}`, path: '/', screen: '/', modelMs: 1000, appMs: 1500, readMs: 0, outcome: 'ok', ...over })
const reached = (index: number, ttfv: number | null, steps = [step(0), step(1)]): FreshEyesSession => ({
  index,
  outcome: 'reached',
  stall: null,
  ttfvSeconds: ttfv,
  appSeconds: 3,
  readSeconds: 0,
  modelSeconds: 2,
  backtracks: 0,
  steps,
  opinions: [],
})

describe('a wait that hit its cap', () => {
  it("on the app's own screen leaves the path without a time; after a step the guard stopped it adds nothing", () => {
    expect(appWaitCapped([step(0), step(1, { capped: true })])).toBe(true)
    expect(appWaitCapped([step(0), step(1, { capped: true, outcome: 'blocked' })])).toBe(false)
    expect(ttfvOf([step(0), step(1, { appMs: 21_000, capped: true, outcome: 'blocked' }), step(2)])).toBe(3)
    expect(ttfvOf([step(0), step(1), step(2)])).toBe(4.5)
  })

  it('is never the app time: such a session has no time, and never counts as 0', () => {
    expect(summarize([reached(1, null), reached(2, 40)]).ttfvSeconds).toBe(40)
    expect(summarize([reached(1, null)]).ttfvSeconds).toBeNull()
  })

  it('travels to the console and the timeline as such', () => {
    const s = reached(1, null, [step(0), step(1, { appMs: 20_000, capped: true })])
    const r = { runId: '20261028-090000-ab12', dir: '/x', goal: 'g', startUrl: 'https://x.test/', model: 'm', dryRun: false, hasAccount: true, startedAt: '2026-10-28T00:00:00.000Z', finishedAt: '2026-10-28T00:10:00.000Z', sessions: [{ ...s, accountId: '7be1a8b0-3380-4981-9a42-2b80d8a4edaf' }], ttfvSeconds: null, steps: 1, reached: 1, stalledAt: null, findings: [], refused: [], blocked: 0, warnings: [] }
    const snap = runSnapshot(r, 'done', null) as { sessions: Array<{ steps: Array<Record<string, unknown>> }> }
    expect(snap.sessions[0]!.steps[1]).toMatchObject({ capped: true })
    expect(snap.sessions[0]!.steps[0]).not.toHaveProperty('capped')
    const md = timelineMarkdown(r)
    expect(md).toContain("not the app's real wait")
    expect(md).toContain('time not measured (a wait hit its cap)')
    expect(md).toContain('Synthetic account: 7be1a8b0-3380-4981-9a42-2b80d8a4edaf')
  })
})

describe('runs with an account', () => {
  it('get 60 steps by default (30 did not reach the CLI step), and --steps still wins', () => {
    expect(stepsFor(undefined, true)).toBe(60)
    expect(stepsFor(undefined, false)).toBe(30)
    expect(stepsFor('12', true)).toBe(12)
  })

  it("keep the minted account's id readable in the record; the password and email are hidden", () => {
    const id = { email: 'fresh-eyes-abc@synthetic.kensaur.us', password: 'test-fixture-not-a-real-password', userId: '7be1a8b0-3380-4981-9a42-2b80d8a4edaf' }
    const out = redact({ log: `signed in as ${id.email} with ${id.password}`, account: id.userId }, id)
    expect(out).toEqual({ log: 'signed in as {{email}} with {{password}}', account: '7be1a8b0-3380-4981-9a42-2b80d8a4edaf' })
  })
})
