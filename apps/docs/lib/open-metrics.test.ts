/**
 * /open counts what a reader can re-query, so the two parsers that turn API
 * responses into numbers are pinned: GitHub's Link header (the count trick at
 * per_page=1) and the release windows, which keep weekly digests apart so a
 * digest is never counted as a shipped release.
 */
import { describe, expect, it } from 'vitest'
import { lastPageFromLink, summarizeReleases, type GithubRelease } from './open-metrics'

describe('lastPageFromLink', () => {
  it('reads the rel="last" page number', () => {
    const link =
      '<https://api.github.com/repositories/1/commits?since=x&per_page=1&page=2>; rel="next", ' +
      '<https://api.github.com/repositories/1/commits?since=x&per_page=1&page=30>; rel="last"'
    expect(lastPageFromLink(link)).toBe(30)
  })

  it('returns null without a last link (a single page)', () => {
    expect(lastPageFromLink(null)).toBeNull()
    expect(lastPageFromLink('<https://api.github.com/x?page=2>; rel="next"')).toBeNull()
  })
})

describe('summarizeReleases', () => {
  const now = new Date('2026-10-02T00:00:00Z')
  const rel = (tag: string, publishedAt: string): GithubRelease => ({
    name: tag,
    tag,
    publishedAt,
    prerelease: tag.startsWith('weekly-'),
  })

  it('counts releases by window and keeps weekly digests apart', () => {
    const s = summarizeReleases(
      [
        rel('@mushi-mushi/mcp@0.22.1', '2026-10-01T11:08:11Z'),
        rel('weekly-2026-W39', '2026-09-25T17:07:01Z'),
        rel('@mushi-mushi/mcp@0.21.1', '2026-09-21T21:55:32Z'),
        rel('@mushi-mushi/core@1.0.0', '2026-07-20T00:00:00Z'),
        rel('@mushi-mushi/core@0.1.0', '2026-04-20T00:00:00Z'),
      ],
      now,
    )
    expect(s.last30).toBe(2)
    expect(s.last90).toBe(3)
    expect(s.weeklyDigestsLast90).toBe(1)
    expect(s.latest?.tag).toBe('@mushi-mushi/mcp@0.22.1')
  })

  it('has no latest release when there are none', () => {
    expect(summarizeReleases([], now).latest).toBeNull()
  })
})
