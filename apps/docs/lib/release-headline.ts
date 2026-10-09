/**
 * The docs announcement bar's one-line summary of the latest release.
 *
 * Highlight titles are sentences that already end in a period. Joined with
 * ", " they read "Own analytics id., Refused batches are not replayed
 * forever." (report 469f6962), so each title loses its closing punctuation
 * and the titles are joined with a middle dot.
 */
export function releaseHeadline(release: {
  headline?: string | null
  highlights?: ReadonlyArray<{ title: string }> | null
}): string {
  if (release.headline) return release.headline
  const titles = (release.highlights ?? [])
    .slice(0, 2)
    .map((h) => h.title.trim().replace(/[\s.:;,]+$/, ''))
    .filter(Boolean)
  return titles.length > 0 ? titles.join(' · ') : 'See what shipped.'
}
