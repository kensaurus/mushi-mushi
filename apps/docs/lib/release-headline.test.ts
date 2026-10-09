import { describe, expect, it } from 'vitest'
import { releaseHeadline } from './release-headline'

describe('releaseHeadline', () => {
  it('drops each title closing punctuation and joins with a middle dot (report 469f6962)', () => {
    expect(
      releaseHeadline({
        highlights: [
          { title: 'Own analytics id.' },
          { title: 'Refused batches are not replayed forever.' },
          { title: 'Third.' },
        ],
      }),
    ).toBe('Own analytics id · Refused batches are not replayed forever')
  })

  it('still strips a trailing colon', () => {
    expect(releaseHeadline({ highlights: [{ title: 'Voice intake:' }] })).toBe('Voice intake')
  })

  it('prefers an explicit headline and falls back when there is nothing', () => {
    expect(releaseHeadline({ headline: 'Hand-written.', highlights: [{ title: 'x.' }] })).toBe('Hand-written.')
    expect(releaseHeadline({ highlights: [] })).toBe('See what shipped.')
    expect(releaseHeadline({})).toBe('See what shipped.')
  })
})
