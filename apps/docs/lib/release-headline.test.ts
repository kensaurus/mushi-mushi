import { describe, expect, it } from 'vitest'
import { bannerRelease, type ChangelogRelease } from './release-headline'

/** The headline the bar shows for one shipped release. */
const releaseHeadline = (r: Pick<ChangelogRelease, 'headline' | 'highlights'>): string =>
  bannerRelease([{ majorMinor: '1.0', pending: false, versions: ['1.0.0'], ...r }])!.headline

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

describe('bannerRelease', () => {
  const next = { majorMinor: 'next', pending: true, headline: 'Unreleased', versions: [], highlights: [] }
  const r132 = { majorMinor: '1.32', pending: false, headline: null, versions: ['1.32.1', '1.32.0'], highlights: [] }
  const r131 = {
    majorMinor: '1.31',
    pending: false,
    headline: null,
    versions: ['1.31.2'],
    highlights: [{ title: 'Close reasons.' }, { title: 'Local dev filter.' }],
  }

  it('skips the pending "next" entry the generator puts first (2026-10-10)', () => {
    const b = bannerRelease([next, r132, r131])
    expect(b?.version).toBe('1.32.1')
    expect(b?.majorMinor).toBe('1.32')
    expect(b?.headline).not.toContain('Unreleased')
  })

  it('takes the headline from the newest shipped release that has one', () => {
    expect(bannerRelease([next, r132, r131])?.headline).toBe('Close reasons · Local dev filter')
  })

  it('renders nothing when no release has shipped', () => {
    expect(bannerRelease([next])).toBeNull()
  })

  it('the real changelog never announces an unreleased version', async () => {
    const changelog = (await import('../data/changelog.json')).default
    const b = bannerRelease(changelog)
    expect(b).not.toBeNull()
    expect(b!.version).toMatch(/^\d+\.\d+\.\d+/)
    expect(b!.headline).not.toBe('Unreleased')
  })
})
