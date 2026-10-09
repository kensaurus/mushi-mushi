/**
 * Public numbers for /open, fetched once at build time (the docs site is a
 * static export). Every source is a public API anyone can re-query, and every
 * fetch degrades to `null` so a rate limit or an outage renders "unavailable
 * at build time" instead of failing the build or inventing a number.
 *
 * Deliberately absent: the GitHub star count (small numbers are anti-proof and
 * say nothing about use) and product usage (signups, activated projects, paid)
 * — those are the owner's to publish from the weekly scorecard.
 */
import { MUSHI_CANONICAL_URLS } from '@mushi-mushi/brand'

const REPO = MUSHI_CANONICAL_URLS.repo.replace('https://github.com/', '')
const FETCH_TIMEOUT_MS = 8_000
const DAY_MS = 86_400_000

/** The packages a new user installs first — the ones worth a download row. */
const OPEN_NPM_PACKAGES = [
  'mushi-mushi',
  '@mushi-mushi/core',
  '@mushi-mushi/web',
  '@mushi-mushi/react',
  '@mushi-mushi/react-native',
  '@mushi-mushi/node',
  '@mushi-mushi/mcp',
  '@mushi-mushi/cli',
] as const

interface NpmDownloads {
  pkg: string
  downloads: number
  start: string
  end: string
}

/** @internal Exported for tests only. */
export interface GithubRelease {
  name: string
  tag: string
  publishedAt: string
  prerelease: boolean
}

interface ReleaseSummary {
  last30: number
  last90: number
  weeklyDigestsLast90: number
  latest: GithubRelease | null
}

export interface OpenMetrics {
  fetchedAt: string
  npm: NpmDownloads[] | null
  releases: ReleaseSummary | null
  commitsLast30: number | null
  contributors: number | null
}

/**
 * GitHub's `Link` header → the page number of `rel="last"` (= item count at per_page=1).
 * @internal Exported for tests only.
 */
export function lastPageFromLink(link: string | null): number | null {
  if (!link) return null
  const last = link.split(',').find((part) => /rel="last"/.test(part))
  const page = last?.match(/[?&]page=(\d+)/)?.[1]
  return page ? Number(page) : null
}

/**
 * Count releases in the last 30 / 90 days; weekly digests are counted apart.
 * @internal Exported for tests only.
 */
export function summarizeReleases(releases: readonly GithubRelease[], now: Date): ReleaseSummary {
  const age = (r: GithubRelease) => now.getTime() - new Date(r.publishedAt).getTime()
  const isDigest = (r: GithubRelease) => r.tag.startsWith('weekly-')
  const sorted = [...releases].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
  return {
    last30: sorted.filter((r) => !isDigest(r) && age(r) <= 30 * DAY_MS).length,
    last90: sorted.filter((r) => !isDigest(r) && age(r) <= 90 * DAY_MS).length,
    weeklyDigestsLast90: sorted.filter((r) => isDigest(r) && age(r) <= 90 * DAY_MS).length,
    latest: sorted.find((r) => !isDigest(r)) ?? null,
  }
}

async function getJson(url: string): Promise<{ body: unknown; link: string | null } | null> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  // CI can lift GitHub's 60-requests-per-hour anonymous limit with a token.
  const token = process.env.GITHUB_TOKEN
  if (token && url.startsWith('https://api.github.com/')) headers.Authorization = `Bearer ${token}`
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    if (!res.ok) return null
    return { body: await res.json(), link: res.headers.get('link') }
  } catch {
    return null
  }
}

async function npmLastWeek(pkg: string): Promise<NpmDownloads | null> {
  const res = await getJson(`https://api.npmjs.org/downloads/point/last-week/${pkg}`)
  const body = res?.body as { downloads?: unknown; start?: unknown; end?: unknown } | undefined
  if (typeof body?.downloads !== 'number') return null
  return { pkg, downloads: body.downloads, start: String(body.start), end: String(body.end) }
}

async function releases(now: Date): Promise<ReleaseSummary | null> {
  const res = await getJson(`https://api.github.com/repos/${REPO}/releases?per_page=100`)
  if (!Array.isArray(res?.body)) return null
  const rows = (res.body as Array<Record<string, unknown>>)
    .filter((r) => r.draft !== true && typeof r.published_at === 'string')
    .map((r) => ({
      name: String(r.name ?? r.tag_name),
      tag: String(r.tag_name),
      publishedAt: String(r.published_at),
      prerelease: r.prerelease === true,
    }))
  return summarizeReleases(rows, now)
}

async function countByLastPage(url: string): Promise<number | null> {
  const res = await getJson(url)
  if (!res) return null
  // One page only: the count is the length of that page.
  return lastPageFromLink(res.link) ?? (Array.isArray(res.body) ? res.body.length : null)
}

export async function fetchOpenMetrics(now = new Date()): Promise<OpenMetrics> {
  const since = new Date(now.getTime() - 30 * DAY_MS).toISOString()
  const [npm, rel, commitsLast30, contributors] = await Promise.all([
    Promise.all(OPEN_NPM_PACKAGES.map(npmLastWeek)),
    releases(now),
    countByLastPage(`https://api.github.com/repos/${REPO}/commits?since=${since}&per_page=1`),
    countByLastPage(`https://api.github.com/repos/${REPO}/contributors?per_page=1&anon=false`),
  ])
  const npmRows = npm.filter((r): r is NpmDownloads => r !== null)
  return {
    fetchedAt: now.toISOString(),
    npm: npmRows.length > 0 ? npmRows : null,
    releases: rel,
    commitsLast30,
    contributors,
  }
}
