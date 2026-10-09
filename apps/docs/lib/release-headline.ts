/**
 * The docs announcement bar's one-line summary of the latest release.
 *
 * Highlight titles are sentences that already end in a period. Joined with
 * ", " they read "Own analytics id., Refused batches are not replayed
 * forever." (report 469f6962), so each title loses its closing punctuation
 * and the titles are joined with a middle dot.
 */

export interface ChangelogRelease {
  majorMinor: string
  headline?: string | null
  pending?: boolean | null
  versions?: ReadonlyArray<string> | null
  highlights?: ReadonlyArray<{ title: string }> | null
}

function releaseHeadline(release: Pick<ChangelogRelease, 'headline' | 'highlights'>): string {
  if (release.headline) return release.headline
  const titles = (release.highlights ?? [])
    .slice(0, 2)
    .map((h) => h.title.trim().replace(/[\s.:;,]+$/, ''))
    .filter(Boolean)
  return titles.length > 0 ? titles.join(' · ') : 'See what shipped.'
}

/**
 * The release the bar announces: the newest one that shipped. The changelog
 * generator puts a pending "next" entry (no versions, headline "Unreleased")
 * first whenever changesets are waiting, and the bar showed it as
 * "vnext · upcoming Unreleased" (2026-10-10). The newest shipped release
 * can also have no highlights yet (patch-only), so the headline comes from
 * the newest shipped release that has something to say; the version stays
 * the newest one.
 */
export function bannerRelease(changelog: ReadonlyArray<ChangelogRelease>): {
  version: string
  majorMinor: string
  headline: string
} | null {
  const shipped = changelog.filter((r) => !r.pending && (r.versions?.length ?? 0) > 0)
  const newest = shipped[0]
  if (!newest) return null
  const described = shipped.find((r) => r.headline || (r.highlights?.length ?? 0) > 0) ?? newest
  return {
    version: newest.versions?.[0] ?? newest.majorMinor,
    majorMinor: newest.majorMinor,
    headline: releaseHeadline(described),
  }
}
