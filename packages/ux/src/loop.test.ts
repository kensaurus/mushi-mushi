// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest'
import { commitMessage, noScreensMessage } from './loop.js'

describe('a run that maps no screen', () => {
  it('blames the dev server when every page returned the same 5xx', () => {
    const skipped = ['/learn: HTTP 500', '/words: HTTP 500', '/alphabet: HTTP 500']
    const msg = noScreensMessage(skipped, "Error: Module not found: Can't resolve (<dynamic> | 'rrweb')")
    expect(msg.split('\n')[0]).toBe("No screen to work on: every page returned HTTP 500, so the app's dev server is failing, not the pages.")
    expect(msg).toContain("The dev server said: Error: Module not found: Can't resolve")
    expect(msg).toContain('dev command')
  })

  it('lists mixed reasons, and says so when nothing was found at all', () => {
    expect(noScreensMessage(['/a: it opens /b/ instead', '/c: HTTP 404'], null).split('\n')[0]).toBe(
      'No screen to work on: all 2 page(s) were skipped (it opens /b/ instead; HTTP 404).',
    )
    expect(noScreensMessage([], null)).toMatch(/^No screen to work on: mapping found no page/)
  })
})

// Host apps build their in-app changelog from commit subjects (glot.it, 2026-10-07).
describe('commit messages for kept attempts', () => {
  const subject = (step: string | null, screen = 'Chat · แชท — glot.it') => commitMessage('/chat/', screen, step, 'Kept.').split('\n')[0]

  it('uses the plan step’s plain summary', () => {
    expect(subject('Fix the low-vocab caption contrast: in `features/word-bank/components/grammar-inline-view.tsx`, replace `text-error/80`')).toBe(
      'fix(ux): fix the low-vocab caption contrast',
    )
  })

  it('drops file names and code from a step with no summary, ending on a whole word', () => {
    const s = subject(
      'In `app/chat/_components/chat-content.tsx`, keep a fixed-height slot for the reconnecting `Alert` between the speak hub and the scenario list, and fill that slot while `chatHealth` is `"checking"`.',
    )
    const summary = s.replace('fix(ux): ', '')
    expect(summary).toMatch(/^keep a fixed-height slot for the reconnecting Alert between/)
    expect(summary.length).toBeLessThanOrEqual(72)
    expect(s).not.toMatch(/\.tsx|`/)
    const words = 'keep a fixed-height slot for the reconnecting Alert between the speak hub and the scenario list'.split(' ')
    for (const w of summary.split(' ')) expect(words).toContain(w)
  })

  it('keeps code names as words, drops paths with their preposition, and never ends inside a bracket', () => {
    expect(subject('Analyze in `features/reader/components/reader-input.tsx` looks like a live CTA while the field is empty.')).toBe(
      'fix(ux): analyze looks like a live CTA while the field is empty',
    )
    expect(subject('In `x.tsx`, pass an accessible `label` into `CircularProgress` (the 0/77 ring beside the long page title) so the progressbar has a name')).toBe(
      'fix(ux): pass an accessible label into CircularProgress',
    )
  })

  it('names the screen without the site suffix when there was no plan, and keeps the details in the body', () => {
    const msg = commitMessage('/friends/challenge/', 'Challenge a Friend | glot.it', null, 'Kept: problem score 1→0.')
    expect(msg.split('\n')[0]).toBe('fix(ux): improve the Challenge a Friend screen')
    expect(msg).toContain('Kept: problem score 1→0.')
    expect(commitMessage('/chat/', 'Chat · แชท — glot.it', 'In `a.tsx`, do x.', 'r')).toContain('Chat · แชท (/chat/): In `a.tsx`, do x.')
  })

  it('wraps the body at 100 characters, which commitlint requires', () => {
    const long = 'Kept, needs your review: the edit changed 1 file(s) but nothing visible in a still screenshot (motion, haptics or another screen). Read the diff.'
    const lines = commitMessage('/chat/', 'Chat', 'In `a.tsx`, ' + 'make the bubble steady '.repeat(8), long).split('\n')
    for (const l of lines) expect([...l].length).toBeLessThanOrEqual(100)
    expect(lines.join(' ').replace(/\s+/g, ' ')).toContain(long)
  })
})
