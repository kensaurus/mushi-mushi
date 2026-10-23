/**
 * FILE: packages/server/supabase/functions/_shared/vuln-watch-db.ts
 * PURPOSE: One project's known-vulnerability check (ADR 0038): read the
 *          primary repo's lockfiles and runtime pins at the default-branch
 *          head, match exact versions on OSV.dev, enrich with CISA KEV and
 *          EPSS, store `dependency_vulns`, file grouped reports under the
 *          daily cap, and record a `portfolio_radar_vulns` gate run.
 *
 * Never green by default: a repo that could not be read, a feed that did not
 * answer or a lockfile that did not load leaves its rule `unknown` / `error`,
 * and a row is only closed when the file it came from was read this run.
 * Raw lockfile text never leaves this function; only coordinates are stored.
 */

import type { getServiceClient } from './db.ts'
import { log } from './logger.ts'
import type { RecipeRepo, RecipeRepoResolution, TreeEntry } from './recipe-github.ts'
import { lockfileKindFor, manifestPathsFor, parseLockfile } from './lockfiles/index.ts'
import type { LockfileKind, ResolvedPackage } from './lockfiles/types.ts'
import { fetchOsvVuln, fixedVersionFor, normalizeAdvisory, queryOsvBatch, type Advisory, type Fetcher, type OsvQuery } from './osv.ts'
import { fetchEpss, fetchKev, fetchReleaseLines, type ReleaseLine } from './vuln-feeds.ts'
import { detectRuntimes, FLOOR_PINS, isRuntimeFile, type Runtime, type RuntimePin } from './runtime-detect.ts'
import { matchRuntimeAdvisory, mergeRuntimeAdvisories, RUNTIME_OSV_PACKAGE, runtimeAdvisoryFromRow, type RuntimeAdvisory } from './runtime-advisories.ts'
import { endOfLifePins, groupMatches, radarResults, reportForGroup, severityFor, type ScanOutcome, type VulnGroup, type VulnMatch } from './vuln-watch.ts'
import { RADAR_VULN_GATE, recordRun, type RadarRunSummary } from './radar/run.ts'

type Db = ReturnType<typeof getServiceClient>

const vlog = log.child('vuln-watch')

export const MAX_LOCKFILES = 20
export const MAX_LOCKFILE_BYTES = 10 * 1024 * 1024
const MAX_RUNTIME_FILES = 40
const MAX_RUNTIME_FILE_BYTES = 256 * 1024
/** Workspace package.json files read beside one pnpm lockfile. */
const MAX_WORKSPACE_MANIFESTS = 200
const MAX_PACKAGES = 10_000
/** Advisory records read from OSV per run; the rest are read on the next run. */
export const MAX_DETAIL_FETCHES = 300
const DETAIL_CONCURRENCY = 8
const FEED_REFRESH_MS = 20 * 3600_000
const IMPORT_CHECK_PACKAGES = 40
export const DEFAULT_DAILY_LIMIT = 10
const OPEN_REPORT_STATUSES = ['new', 'pending', 'submitted', 'queued', 'classified', 'grouped', 'fixing', 'triaged', 'in_progress', 'reopened']
/** Fixtures and examples carry lockfiles nobody ships. */
const SKIP_DIR_RE = /(?:^|\/)(?:node_modules|vendor|\.git|fixtures|__fixtures__|testdata|__mocks__|examples?)\//

export interface VulnWatchDeps {
  resolveRepo: (db: Db, projectId: string) => Promise<RecipeRepoResolution>
  getDefaultHead: (repo: RecipeRepo) => Promise<{ branch: string; sha: string }>
  listTree: (repo: RecipeRepo, sha: string) => Promise<{ entries: TreeEntry[]; truncated: boolean }>
  readBlobs: (repo: RecipeRepo, sha: string, paths: readonly string[]) => Promise<Map<string, string | null>>
  readBlobText: (repo: RecipeRepo, blobSha: string, size: number, maxBytes: number) => Promise<string | null>
  fetcher: Fetcher
  now: () => Date
  /** Release lines per runtime, shared by every project of one invocation. */
  releaseLineCache?: Map<Runtime, ReleaseLine[] | Error>
  /**
   * One run per project at a time (two overlapping runs would both file the
   * same reports): `claim` returns the run id, or null while another run
   * holds the project; `release` ends it. Absent → no lease.
   */
  lease?: RunLease
  /** Packages checked per run; MAX_PACKAGES unless a test lowers it. */
  maxPackages?: number
}

export interface RunLease {
  claim: (db: Db, projectId: string) => Promise<string | null>
  release: (db: Db, projectId: string, runId: string) => Promise<void>
}

/** A lease left by a run that died expires after this; a live run releases it when it ends. */
export const RUN_LEASE_SEC = 600

/**
 * The lease through vuln_watch_claim / vuln_watch_release (migration
 * 20261022120346): an atomic claim of the project's row that a finished run
 * deletes. A failed claim refuses the run (fails closed): a skipped check
 * reads as stale, a doubled one files duplicate reports.
 */
export const dbRunLease: RunLease = {
  claim: async (db, projectId) => {
    const { data, error } = await db.rpc('vuln_watch_claim', { p_project_id: projectId, p_ttl_seconds: RUN_LEASE_SEC })
    if (error) throw new Error(`could not take the run lease: ${error.message}`)
    return typeof data === 'string' ? data : null
  },
  release: async (db, projectId, runId) => {
    const { error } = await db.rpc('vuln_watch_release', { p_project_id: projectId, p_run_id: runId })
    if (error) vlog.warn('lease not released; it expires on its own', { projectId, err: error.message })
  },
}

/** When another run holds the project, until when; null when it is free. */
export async function leaseHeldUntil(db: Db, projectId: string, now: Date): Promise<string | null> {
  const { data } = await db.from('vuln_watch_leases').select('claimed_until').eq('project_id', projectId).maybeSingle()
  const until = (data as { claimed_until?: string } | null)?.claimed_until
  return until && Date.parse(until) > now.getTime() ? until : null
}

export interface VulnWatchSummary {
  status: 'not_set_up' | 'already_running' | RadarRunSummary['status']
  runId: string | null
  commitSha: string | null
  lockfiles: number
  packages: number
  matches: number
  groups: number
  filed: number
  capped: number
  warnings: string[]
}

const errText = (err: unknown) => ((err as Error)?.message ?? String(err)).slice(0, 300)

/** True when the migration that creates dependency_vulns has not been applied. */
export async function vulnTablesMissing(db: Db): Promise<boolean> {
  const { error } = await db.from('dependency_vulns').select('id', { head: true, count: 'exact' }).limit(1)
  return Boolean(error && (error.code === '42P01' || error.code === 'PGRST205' || /does not exist|could not find the table/i.test(error.message)))
}

// ── repo read ────────────────────────────────────────────────────────────────

interface RepoRead {
  lockfiles: Array<{ path: string; kind: LockfileKind; text: string }>
  manifests: Record<string, string>
  runtimeFiles: Record<string, string>
  /** Lockfiles that were listed but could not be read (too large, binary, error). */
  unread: string[]
  warnings: string[]
}

function depth(p: string): number {
  return p.split('/').length
}

async function readRepo(repo: RecipeRepo, sha: string, entries: TreeEntry[], deps: VulnWatchDeps): Promise<RepoRead> {
  const warnings: string[] = []
  const usable = entries.filter((e) => !SKIP_DIR_RE.test(e.path))
  const byPath = new Map(usable.map((e) => [e.path, e]))
  const lockEntries = usable.filter((e) => lockfileKindFor(e.path) != null).sort((a, b) => depth(a.path) - depth(b.path) || a.path.localeCompare(b.path))
  if (lockEntries.length > MAX_LOCKFILES) warnings.push(`${lockEntries.length} lockfiles found; the ${MAX_LOCKFILES} nearest the repo root were checked.`)
  const locks = lockEntries.slice(0, MAX_LOCKFILES)
  const manifestPaths = new Set<string>()
  for (const l of locks) for (const m of manifestPathsFor(l.path)) if (byPath.has(m)) manifestPaths.add(m)
  // A pnpm workspace lockfile needs each importer's package.json to tell an
  // auto-installed peer from a declared dependency (lockfiles/pnpm.ts).
  for (const l of locks.filter((x) => lockfileKindFor(x.path) === 'pnpm')) {
    const dir = l.path.includes('/') ? l.path.slice(0, l.path.lastIndexOf('/') + 1) : ''
    usable
      .filter((e) => e.path.startsWith(dir) && /(^|\/)package\.json$/.test(e.path) && e.size <= MAX_RUNTIME_FILE_BYTES)
      .slice(0, MAX_WORKSPACE_MANIFESTS)
      .forEach((e) => manifestPaths.add(e.path))
  }
  const runtimePaths = usable.filter((e) => isRuntimeFile(e.path) && e.size <= MAX_RUNTIME_FILE_BYTES).sort((a, b) => depth(a.path) - depth(b.path) || a.path.localeCompare(b.path)).slice(0, MAX_RUNTIME_FILES).map((e) => e.path)

  const unread: string[] = []
  const small = [...new Set([...locks.filter((l) => l.size <= MAX_LOCKFILE_BYTES).map((l) => l.path), ...manifestPaths, ...runtimePaths])]
  for (const l of locks) if (l.size > MAX_LOCKFILE_BYTES) unread.push(l.path)
  const texts = small.length ? await deps.readBlobs(repo, sha, small) : new Map<string, string | null>()
  // GraphQL truncates big blobs; read those through the blobs API.
  for (const [path, text] of texts) {
    if (text != null) continue
    const e = byPath.get(path)
    if (e) texts.set(path, await deps.readBlobText(repo, e.sha, e.size, MAX_LOCKFILE_BYTES))
  }
  const out: RepoRead = { lockfiles: [], manifests: {}, runtimeFiles: {}, unread, warnings }
  for (const l of locks) {
    const text = texts.get(l.path)
    if (typeof text === 'string') out.lockfiles.push({ path: l.path, kind: lockfileKindFor(l.path)!, text })
    else if (!unread.includes(l.path)) unread.push(l.path)
  }
  for (const m of manifestPaths) {
    const t = texts.get(m)
    if (typeof t === 'string') out.manifests[m] = t
  }
  for (const r of runtimePaths) {
    const t = texts.get(r)
    if (typeof t === 'string') out.runtimeFiles[r] = t
  }
  if (unread.length) warnings.push(`Could not read ${unread.slice(0, 3).join(', ')}${unread.length > 3 ? ` and ${unread.length - 3} more` : ''} (too large or not text).`)
  return out
}

// ── advisories ───────────────────────────────────────────────────────────────

function advisoryFromRow(r: Record<string, unknown>): Advisory {
  return {
    id: r.id as string,
    modified: (r.modified as string) ?? '',
    published: (r.published as string | null) ?? null,
    withdrawn: (r.withdrawn as string | null) ?? null,
    aliases: (r.aliases as string[]) ?? [],
    cveIds: (r.cve_ids as string[]) ?? [],
    summary: (r.summary as string) ?? '',
    detailsExcerpt: (r.details_excerpt as string) ?? '',
    severityLabel: (r.severity_label as string | null) ?? null,
    cvssVector: (r.cvss_vector as string | null) ?? null,
    cvssScore: r.cvss_score == null ? null : Number(r.cvss_score),
    disputed: r.disputed === true,
    url: r.url as string,
    affected: (r.affected as Advisory['affected']) ?? [],
  }
}

function advisoryRow(a: Advisory, now: Date) {
  return {
    id: a.id, modified: a.modified, published: a.published, withdrawn: a.withdrawn, aliases: a.aliases, cve_ids: a.cveIds,
    summary: a.summary, details_excerpt: a.detailsExcerpt, severity_label: a.severityLabel, cvss_vector: a.cvssVector,
    cvss_score: a.cvssScore, disputed: a.disputed, url: a.url, affected: a.affected, fetched_at: now.toISOString(),
  }
}

async function inChunks<T>(items: readonly T[], size: number, fn: (chunk: T[]) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += size) await fn(items.slice(i, i + size))
}

/** Cached advisories, refetching those OSV says changed; at most MAX_DETAIL_FETCHES reads. */
async function loadAdvisories(db: Db, hits: Map<string, string>, deps: VulnWatchDeps, warnings: string[]): Promise<Map<string, Advisory>> {
  const ids = [...hits.keys()]
  const out = new Map<string, Advisory>()
  await inChunks(ids, 200, async (chunk) => {
    const { data, error } = await db.from('vuln_advisories').select('*').in('id', chunk)
    if (error) throw new Error(`could not read vuln_advisories: ${error.message}`)
    for (const r of (data ?? []) as Array<Record<string, unknown>>) out.set(r.id as string, advisoryFromRow(r))
  })
  const stale = ids.filter((id) => !out.has(id) || (hits.get(id) && out.get(id)!.modified !== hits.get(id)))
  const toFetch = stale.slice(0, MAX_DETAIL_FETCHES)
  if (stale.length > toFetch.length) warnings.push(`${stale.length - toFetch.length} advisories are read on the next run (OSV detail limit per run).`)
  const fresh: Advisory[] = []
  for (let i = 0; i < toFetch.length; i += DETAIL_CONCURRENCY) {
    const batch = toFetch.slice(i, i + DETAIL_CONCURRENCY)
    const got = await Promise.all(batch.map((id) => fetchOsvVuln(id, deps.fetcher).catch((err) => err as Error)))
    got.forEach((raw, k) => {
      if (raw instanceof Error) {
        warnings.push(`Advisory ${batch[k]} could not be read: ${errText(raw)}`)
        return
      }
      const a = raw ? normalizeAdvisory(raw) : null
      if (a) fresh.push(a)
    })
  }
  const now = deps.now()
  await inChunks(fresh, 100, async (chunk) => {
    const { error } = await db.from('vuln_advisories').upsert(chunk.map((a) => advisoryRow(a, now)), { onConflict: 'id' })
    if (error) warnings.push(`Advisory cache not updated: ${error.message.slice(0, 160)}`)
  })
  for (const a of fresh) out.set(a.id, a)
  return out
}

// ── KEV and EPSS ─────────────────────────────────────────────────────────────

interface CveSignal {
  kev: boolean
  epss: number | null
}

async function refreshKev(db: Db, deps: VulnWatchDeps, warnings: string[]): Promise<void> {
  const { data: state } = await db.from('vuln_feed_state').select('fetched_at, error').eq('feed', 'cisa_kev').maybeSingle()
  const fetchedAt = (state as { fetched_at?: string } | null)?.fetched_at
  if (fetchedAt && deps.now().getTime() - Date.parse(fetchedAt) < FEED_REFRESH_MS) return
  try {
    const kev = await fetchKev(deps.fetcher)
    const now = deps.now().toISOString()
    await inChunks(kev.entries, 500, async (chunk) => {
      const { error } = await db.from('vuln_cve_signals').upsert(
        chunk.map((e) => ({ cve_id: e.cveId, kev_date_added: e.dateAdded, kev_due_date: e.dueDate, kev_ransomware: e.ransomware, updated_at: now })),
        { onConflict: 'cve_id' },
      )
      if (error) throw new Error(error.message)
    })
    await db.from('vuln_feed_state').upsert({ feed: 'cisa_kev', version: kev.catalogVersion, entries: kev.entries.length, fetched_at: now, error: null }, { onConflict: 'feed' })
  } catch (err) {
    warnings.push(`CISA's known-exploited list could not be refreshed: ${errText(err)}`)
    await db.from('vuln_feed_state').upsert({ feed: 'cisa_kev', fetched_at: fetchedAt ?? new Date(0).toISOString(), error: errText(err) }, { onConflict: 'feed' })
  }
}

async function loadSignals(db: Db, cveIds: string[], deps: VulnWatchDeps, warnings: string[]): Promise<Map<string, CveSignal>> {
  const out = new Map<string, CveSignal>()
  if (cveIds.length === 0) return out
  await refreshKev(db, deps, warnings)
  const rows = new Map<string, { kev_date_added: string | null; epss: number | null; updated_at: string; epss_date: string | null }>()
  await inChunks(cveIds, 200, async (chunk) => {
    const { data } = await db.from('vuln_cve_signals').select('cve_id, kev_date_added, epss, epss_date, updated_at').in('cve_id', chunk)
    for (const r of (data ?? []) as Array<{ cve_id: string; kev_date_added: string | null; epss: number | null; epss_date: string | null; updated_at: string }>) rows.set(r.cve_id, r)
  })
  const now = deps.now()
  const needEpss = cveIds.filter((c) => {
    const r = rows.get(c)
    return !r || r.epss_date == null || now.getTime() - Date.parse(`${r.epss_date}T00:00:00Z`) > 2 * 86400_000
  })
  if (needEpss.length) {
    try {
      const scores = await fetchEpss(needEpss, deps.fetcher)
      // epss_date is "EPSS checked as of": a CVE EPSS has not scored yet (new
      // ones often) is stored with no score, so it is asked again in 2 days, not every run.
      const today = now.toISOString().slice(0, 10)
      const scored = new Set(scores.map((s) => s.cveId))
      const upserts = [
        ...scores.map((s) => ({ cve_id: s.cveId, epss: Number(s.epss.toFixed(5)), epss_percentile: Number(s.percentile.toFixed(5)), epss_date: s.date ?? today, updated_at: now.toISOString() })),
        ...needEpss.filter((c) => !scored.has(c) && /^CVE-\d{4}-\d{4,}$/.test(c)).map((c) => ({ cve_id: c, epss_date: today, updated_at: now.toISOString() })),
      ]
      if (upserts.length) {
        const { error } = await db.from('vuln_cve_signals').upsert(upserts, { onConflict: 'cve_id' })
        if (error) warnings.push(`EPSS not stored: ${error.message.slice(0, 160)}`)
      }
      for (const s of scores) rows.set(s.cveId, { ...(rows.get(s.cveId) ?? { kev_date_added: null, updated_at: now.toISOString(), epss_date: null }), epss: s.epss, epss_date: s.date })
    } catch (err) {
      warnings.push(`EPSS could not be read: ${errText(err)}`)
    }
  }
  for (const c of cveIds) {
    const r = rows.get(c)
    out.set(c, { kev: Boolean(r?.kev_date_added), epss: r?.epss == null ? null : Number(r.epss) })
  }
  return out
}

function signalFor(cveIds: readonly string[], signals: Map<string, CveSignal>): CveSignal {
  let kev = false
  let epss: number | null = null
  for (const c of cveIds) {
    const s = signals.get(c)
    if (!s) continue
    kev ||= s.kev
    if (s.epss != null && (epss == null || s.epss > epss)) epss = s.epss
  }
  return { kev, epss }
}

// ── import check ─────────────────────────────────────────────────────────────

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`)
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
}

/** Where the app's indexed code imports each package (npm and PyPI, from 600-char previews). */
async function importSites(db: Db, projectId: string, pkgs: Array<{ ecosystem: string; name: string }>): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  for (const p of pkgs.slice(0, IMPORT_CHECK_PACKAGES)) {
    const module = p.ecosystem === 'PyPI' ? p.name.replace(/-/g, '_') : p.name
    const { data, error } = await db
      .from('project_codebase_files')
      .select('file_path, content_preview')
      .eq('project_id', projectId)
      .is('tombstoned_at', null)
      .ilike('content_preview', `%${escapeLike(module)}%`)
      .limit(20)
    if (error) return out
    const re = p.ecosystem === 'npm'
      ? new RegExp(`(?:from\\s+|require\\(\\s*|import\\(\\s*|import\\s+)['"]${escapeRe(module)}(?:/[^'"]*)?['"]`)
      : new RegExp(`^\\s*(?:from\\s+${escapeRe(module)}(?:\\.|\\s)|import\\s+${escapeRe(module)}\\b)`, 'm')
    const hit = ((data ?? []) as Array<{ file_path: string; content_preview: string | null }>).find((f) => re.test(f.content_preview ?? ''))
    if (hit) out.set(`${p.ecosystem}|${p.name}`, hit.file_path)
  }
  return out
}

// ── the run ──────────────────────────────────────────────────────────────────

interface Installed extends ResolvedPackage {
  sourcePath: string
  lockfileKind: LockfileKind
}

function matchKey(m: Pick<VulnMatch, 'sourcePath' | 'ecosystem' | 'name' | 'version' | 'advisoryId'>): string {
  return `${m.sourcePath}\u0000${m.ecosystem}\u0000${m.name}\u0000${m.version}\u0000${m.advisoryId}`
}

function startOfUtcDay(d: Date): string {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString()
}

export async function runVulnWatch(db: Db, projectId: string, deps: VulnWatchDeps, triggeredBy = 'manual'): Promise<VulnWatchSummary> {
  const empty: VulnWatchSummary = { status: 'not_set_up', runId: null, commitSha: null, lockfiles: 0, packages: 0, matches: 0, groups: 0, filed: 0, capped: 0, warnings: [] }
  if (await vulnTablesMissing(db)) return empty
  if (!deps.lease) return checkProject(db, projectId, deps, triggeredBy)
  const leaseId = await deps.lease.claim(db, projectId)
  if (!leaseId) return { ...empty, status: 'already_running', warnings: ['Another check of this project is running.'] }
  try {
    return await checkProject(db, projectId, deps, triggeredBy)
  } finally {
    await deps.lease.release(db, projectId, leaseId)
  }
}

async function checkProject(db: Db, projectId: string, deps: VulnWatchDeps, triggeredBy: string): Promise<VulnWatchSummary> {
  const now = deps.now()
  const warnings: string[] = []
  const empty: VulnWatchSummary = { status: 'not_set_up', runId: null, commitSha: null, lockfiles: 0, packages: 0, matches: 0, groups: 0, filed: 0, capped: 0, warnings }

  const outcome: ScanOutcome = { lockfiles: [], pins: [], groups: [], eol: [], releaseLines: new Map(), packageError: null, runtimeError: null, unreadable: null }
  const record = async (sha: string | null, extra: Record<string, unknown>): Promise<RadarRunSummary> =>
    recordRun(db, projectId, RADAR_VULN_GATE, triggeredBy, sha, radarResults(outcome), { ...extra, warnings: warnings.slice(0, 20) }, now)

  let resolution: RecipeRepoResolution
  try {
    resolution = await deps.resolveRepo(db, projectId)
  } catch (err) {
    outcome.packageError = outcome.runtimeError = `could not read the repo: ${errText(err)}`
    const run = await record(null, {})
    return { ...empty, status: run.status, runId: run.runId }
  }
  if (!resolution.ok) {
    outcome.unreadable = resolution.reason
    const run = await record(null, {})
    return { ...empty, status: run.status, runId: run.runId }
  }
  const repo = resolution.repo
  const { data: repoRow } = await db.from('project_repos').select('id').eq('project_id', projectId).eq('is_primary', true).maybeSingle()
  const repoId = (repoRow as { id?: string } | null)?.id
  if (!repoId) {
    outcome.unreadable = 'No primary GitHub repo is connected to this project.'
    const run = await record(null, {})
    return { ...empty, status: run.status, runId: run.runId }
  }

  let sha: string
  let read: RepoRead
  // Every path in the tree, when GitHub listed all of it: a row whose file is gone closes.
  let treePaths: Set<string> | null = null
  try {
    sha = (await deps.getDefaultHead(repo)).sha
    const tree = await deps.listTree(repo, sha)
    if (tree.truncated) warnings.push('GitHub listed only part of the repo tree, so some lockfiles may be missing.')
    else treePaths = new Set(tree.entries.map((e) => e.path))
    read = await readRepo(repo, sha, tree.entries, deps)
    warnings.push(...read.warnings)
  } catch (err) {
    outcome.packageError = outcome.runtimeError = `could not read the repo: ${errText(err)}`
    const run = await record(null, {})
    return { ...empty, status: run.status, runId: run.runId, warnings }
  }

  // Parse: coordinates only from here on.
  const installed: Installed[] = []
  const readSources = new Set<string>()
  for (const l of read.lockfiles) {
    const parsed = parseLockfile(l.path, l.text, read.manifests)
    if (!parsed) continue
    for (const w of parsed.warnings.slice(0, 3)) warnings.push(`${l.path}: ${w}`)
    readSources.add(l.path)
    outcome.lockfiles.push(l.path)
    for (const p of parsed.packages) installed.push({ ...p, sourcePath: l.path, lockfileKind: l.kind })
  }
  const maxPackages = deps.maxPackages ?? MAX_PACKAGES
  if (installed.length > maxPackages) {
    warnings.push(`${installed.length} installed packages; the first ${maxPackages} were checked.`)
    // A lockfile cut short was not fully read: none of its rows may close this run.
    for (const p of installed.slice(maxPackages)) readSources.delete(p.sourcePath)
    installed.length = maxPackages
  }
  outcome.pins = detectRuntimes(read.runtimeFiles)
  // Every runtime file read counts, so a pin removed from it closes its rows.
  for (const path of Object.keys(read.runtimeFiles)) readSources.add(path)
  const exactPins = outcome.pins.filter((p) => p.exact)

  // OSV: one batch for packages and exact runtime pins.
  const coords = new Map<string, OsvQuery>()
  for (const p of installed) coords.set(`${p.ecosystem}\u0000${p.name}\u0000${p.version}`, { ecosystem: p.ecosystem, name: p.name, version: p.version })
  for (const p of exactPins) {
    const osv = RUNTIME_OSV_PACKAGE[p.runtime]
    coords.set(`${osv.ecosystem}\u0000${osv.name}\u0000${p.version}`, { ecosystem: osv.ecosystem, name: osv.name, version: p.version })
  }
  const queries = [...coords.values()]
  const hitsByCoord = new Map<string, Array<{ id: string; modified: string }>>()
  let advisories = new Map<string, Advisory>()
  if (queries.length > 0) {
    try {
      const results = await queryOsvBatch(queries, deps.fetcher)
      const hitModified = new Map<string, string>()
      results.forEach((hits, i) => {
        const q = queries[i]
        hitsByCoord.set(`${q.ecosystem}\u0000${q.name}\u0000${q.version}`, hits)
        for (const h of hits) hitModified.set(h.id, h.modified)
      })
      advisories = await loadAdvisories(db, hitModified, deps, warnings)
    } catch (err) {
      outcome.packageError = `OSV.dev did not answer: ${errText(err)}`
    }
  }

  // Curated runtime advisories (code + table).
  let curated: RuntimeAdvisory[] = mergeRuntimeAdvisories([])
  {
    const { data, error } = await db.from('runtime_advisories').select('*')
    if (!error) curated = mergeRuntimeAdvisories(((data ?? []) as Array<Record<string, unknown>>).map(runtimeAdvisoryFromRow).filter((a): a is RuntimeAdvisory => a != null))
  }

  // Matches (signals filled in after the CVE list is known).
  const matches: VulnMatch[] = []
  const base = (a: Advisory) => ({
    advisoryId: a.id, aliases: a.aliases, cveIds: a.cveIds, title: a.summary || a.detailsExcerpt.split('\n')[0].slice(0, 200), url: a.url,
    severityLabel: a.severityLabel, cvssScore: a.cvssScore, disputed: a.disputed, kev: false, epss: null, imported: null, importedIn: null,
  })
  for (const p of installed) {
    for (const h of hitsByCoord.get(`${p.ecosystem}\u0000${p.name}\u0000${p.version}`) ?? []) {
      const a = advisories.get(h.id)
      if (!a || a.withdrawn) continue
      matches.push({
        kind: 'package', ecosystem: p.ecosystem, name: p.name, version: p.version, dev: p.dev, direct: p.direct, sourcePath: p.sourcePath, sourceLine: null,
        lockfileKind: p.lockfileKind, runtime: null, ...base(a), fixedVersion: fixedVersionFor(a, p.ecosystem, p.name, p.version), mitigations: [],
      })
    }
  }
  for (const pin of exactPins) {
    const osv = RUNTIME_OSV_PACKAGE[pin.runtime]
    const osvMatches: VulnMatch[] = []
    for (const h of hitsByCoord.get(`${osv.ecosystem}\u0000${osv.name}\u0000${pin.version}`) ?? []) {
      const a = advisories.get(h.id)
      if (!a || a.withdrawn) continue
      osvMatches.push({
        kind: 'runtime', ecosystem: osv.ecosystem, name: pin.runtime, version: pin.version, dev: false, direct: true, sourcePath: pin.source, sourceLine: pin.line,
        lockfileKind: null, runtime: pin.runtime, ...base(a), fixedVersion: fixedVersionFor(a, osv.ecosystem, osv.name, pin.version), mitigations: [],
      })
    }
    for (const adv of curated.filter((c) => c.runtime === pin.runtime)) {
      const hit = matchRuntimeAdvisory(adv, pin.version)
      if (!hit.affected) continue
      const covered = osvMatches.filter((m) => m.cveIds.some((c) => adv.cveIds.includes(c)))
      // OSV's records carry the vendor's stopgaps from here on.
      for (const m of covered) m.mitigations = adv.mitigations
      // Drop the curated row only once OSV knows every CVE in it (php2shell
      // had one of its two CVEs in OSV the morning after).
      const known = new Set(covered.flatMap((m) => m.cveIds))
      if (adv.cveIds.length > 0 && adv.cveIds.every((c) => known.has(c))) continue
      osvMatches.push({
        kind: 'runtime', ecosystem: 'runtime', name: pin.runtime, version: pin.version, dev: false, direct: true, sourcePath: pin.source, sourceLine: pin.line,
        lockfileKind: null, runtime: pin.runtime, advisoryId: adv.id, aliases: adv.cveIds, cveIds: adv.cveIds, title: adv.title, url: adv.url,
        severityLabel: adv.severity.toUpperCase(), cvssScore: null, disputed: false, kev: false, epss: null, imported: null, importedIn: null,
        fixedVersion: hit.fixedVersion, mitigations: adv.mitigations,
      })
    }
    matches.push(...osvMatches)
  }

  // Enrichment.
  const cves = [...new Set(matches.flatMap((m) => m.cveIds))]
  const signals = await loadSignals(db, cves, deps, warnings)
  const importCandidates = [...new Map(matches.filter((m) => m.kind === 'package' && !m.dev && (m.ecosystem === 'npm' || m.ecosystem === 'PyPI')).map((m) => [`${m.ecosystem}|${m.name}`, { ecosystem: m.ecosystem, name: m.name }])).values()]
  const imports = await importSites(db, projectId, importCandidates)
  for (const m of matches) {
    const s = signalFor(m.cveIds, signals)
    m.kev = s.kev
    m.epss = s.epss
    const site = m.kind === 'package' ? imports.get(`${m.ecosystem}|${m.name}`) : undefined
    if (site) {
      m.imported = true
      m.importedIn = site
    }
  }
  outcome.groups = groupMatches(matches)

  // End of life.
  const runtimes = [...new Set(outcome.pins.map((p) => p.runtime))]
  const cache = deps.releaseLineCache ?? new Map<Runtime, ReleaseLine[] | Error>()
  const lines = new Map<Runtime, ReleaseLine[]>()
  for (const r of runtimes) {
    if (!cache.has(r)) cache.set(r, await fetchReleaseLines(r, deps.fetcher).catch((err) => err as Error))
    const got = cache.get(r)!
    if (got instanceof Error) outcome.runtimeError = `endoflife.date did not answer: ${errText(got)}`
    else lines.set(r, got)
  }
  outcome.releaseLines = lines
  outcome.eol = endOfLifePins(outcome.pins, lines)

  // Persist dependency_vulns.
  const groupOf = new Map<string, VulnGroup>()
  for (const g of outcome.groups) for (const m of g.matches) groupOf.set(matchKey(m), g)
  const { data: existingRows, error: exErr } = await db
    .from('dependency_vulns')
    .select('id, source_path, ecosystem, package_name, installed_version, advisory_id, status, report_id, group_key, kind')
    .eq('repo_id', repoId)
    .limit(20_000)
  if (exErr) throw new Error(`could not read dependency_vulns: ${exErr.message}`)
  type Row = { id: string; source_path: string; ecosystem: string; package_name: string; installed_version: string; advisory_id: string; status: string; report_id: string | null; group_key: string; kind: string }
  // The state before this run's writes, read once.
  const before: Row[] = ((existingRows ?? []) as Row[]).map((r) => ({ ...r }))
  const existing = new Map<string, Row>()
  for (const r of before) existing.set(`${r.source_path}\u0000${r.ecosystem}\u0000${r.package_name}\u0000${r.installed_version}\u0000${r.advisory_id}`, r)

  const seen = new Set<string>()
  const upserts: Array<Record<string, unknown>> = []
  const touchDismissed: string[] = []
  // Groups a person dismissed (every row of them): never filed, never on the radar.
  const dismissedGroups = new Set<string>()
  for (const g of outcome.groups) {
    let allDismissed = g.matches.length > 0
    for (const m of g.matches) {
      const k = matchKey(m)
      const prev = existing.get(k)
      if (prev?.status !== 'dismissed') allDismissed = false
      if (seen.has(k)) continue
      seen.add(k)
      if (prev?.status === 'dismissed') {
        touchDismissed.push(prev.id)
        continue
      }
      const sev = severityFor(m)
      upserts.push({
        project_id: projectId, repo_id: repoId, kind: m.kind, ecosystem: m.ecosystem, package_name: m.name, installed_version: m.version,
        dev: m.dev, direct: m.direct, source_path: m.sourcePath, source_line: m.sourceLine, advisory_id: m.advisoryId, cve_ids: m.cveIds,
        title: m.title.slice(0, 300), advisory_url: m.url, severity: sev.severity, severity_reasons: sev.reasons, fixed_version: m.fixedVersion,
        kev: m.kev, epss: m.epss == null ? null : Number(m.epss.toFixed(5)), imported: m.imported, group_key: groupOf.get(k)?.key ?? g.key,
        status: 'open', resolved_at: null, commit_sha: sha, last_seen_at: now.toISOString(),
      })
    }
    if (allDismissed) dismissedGroups.add(g.key)
  }
  await inChunks(upserts, 200, async (chunk) => {
    const { error } = await db.from('dependency_vulns').upsert(chunk, { onConflict: 'repo_id,source_path,ecosystem,package_name,installed_version,advisory_id' })
    if (error) throw new Error(`could not store dependency_vulns: ${error.message}`)
  })
  await inChunks(touchDismissed, 200, async (chunk) => {
    await db.from('dependency_vulns').update({ last_seen_at: now.toISOString(), commit_sha: sha }).in('id', chunk)
  })

  // Close what this run read and no longer matched.
  const stillInstalled = new Set([
    ...installed.map((p) => `${p.sourcePath}\u0000${p.ecosystem}\u0000${p.name}\u0000${p.version}`),
    ...exactPins.flatMap((p) => [RUNTIME_OSV_PACKAGE[p.runtime].ecosystem, 'runtime'].map((eco) => `${p.source}\u0000${eco}\u0000${p.runtime}\u0000${p.version}`)),
  ])
  const toFixed: string[] = []
  const toWithdrawn: string[] = []
  const osvAnswered = outcome.packageError == null
  for (const [k, r] of existing) {
    if (r.status !== 'open' || seen.has(k)) continue
    // The file is gone from a fully listed tree (deleted, moved, npm → pnpm): nothing there is installed.
    if (treePaths && !treePaths.has(r.source_path)) {
      toFixed.push(r.id)
      continue
    }
    if (!readSources.has(r.source_path)) continue
    const coord = `${r.source_path}\u0000${r.ecosystem}\u0000${r.package_name}\u0000${r.installed_version}`
    if (!stillInstalled.has(coord)) toFixed.push(r.id)
    // Still installed but no longer matched: OSV withdrew or narrowed it, or a
    // curated runtime row is superseded by OSV. Only decided when OSV answered.
    else if (osvAnswered) toWithdrawn.push(r.id)
  }
  for (const [ids, status] of [[toFixed, 'fixed'], [toWithdrawn, 'withdrawn']] as const) {
    await inChunks(ids, 200, async (chunk) => {
      const { error } = await db.from('dependency_vulns').update({ status, resolved_at: now.toISOString() }).in('id', chunk)
      if (error) warnings.push(`Could not close ${chunk.length} rows: ${error.message.slice(0, 120)}`)
    })
  }

  // File reports (ADR 0038 decision 4), one per group, capped per app per day.
  let filed = 0
  let capped = 0
  outcome.groups = outcome.groups.filter((g) => !dismissedGroups.has(g.key))
  const fileable = outcome.groups.filter((g) => g.fileable && g.target)
  if (fileable.length > 0) {
    const [{ data: settings }, { count: filedToday }] = await Promise.all([
      db.from('project_settings').select('vuln_reports_daily_limit').eq('project_id', projectId).maybeSingle(),
      db.from('reports').select('id', { count: 'exact', head: true }).eq('project_id', projectId).eq('source', 'security_advisory').gte('created_at', startOfUtcDay(now)),
    ])
    const limit = (settings as { vuln_reports_daily_limit?: number } | null)?.vuln_reports_daily_limit ?? DEFAULT_DAILY_LIMIT
    let budget = Math.max(0, limit - (filedToday ?? 0))
    // A package that already has a report in this repo takes new advisories
    // into it while it is open; a report a person closed is not filed again
    // for the same upgrade, only for a newer one (a higher fixed version).
    const linked = before.filter((r) => r.report_id)
    const reportIds = [...new Set(linked.map((r) => r.report_id!))]
    const openReports = new Set<string>()
    if (reportIds.length) {
      const { data: reps } = await db.from('reports').select('id, status').in('id', reportIds)
      for (const r of (reps ?? []) as Array<{ id: string; status: string }>) if (OPEN_REPORT_STATUSES.includes(r.status)) openReports.add(r.id)
    }
    for (const g of fileable) {
      // A runtime group spans OSV (Bitnami, Go) and curated rows, so it matches on the runtime alone.
      const samePackage = linked.filter((r) => r.kind === g.kind && r.package_name === g.name && (g.kind === 'runtime' || r.ecosystem === g.ecosystem))
      const openFor = samePackage.find((r) => openReports.has(r.report_id!))
      if (openFor) {
        await db.from('dependency_vulns').update({ report_id: openFor.report_id }).eq('repo_id', repoId).eq('group_key', g.key).eq('status', 'open').is('report_id', null)
        continue
      }
      if (samePackage.some((r) => r.group_key === g.key)) continue
      if (budget <= 0) {
        capped++
        continue
      }
      const r = reportForGroup(g, { repoUrl: repo.repoUrl, commitSha: sha })
      const { data: report, error } = await db.from('reports').insert({
        project_id: projectId,
        source: 'security_advisory',
        category: 'other',
        description: r.description,
        summary: r.summary,
        component: r.component,
        severity: r.severity,
        status: 'classified',
        confidence: 1,
        bug_ontology_tags: r.tags,
        reporter_token_hash: 'cron:vuln-watch',
        environment: r.environment,
      }).select('id').maybeSingle()
      if (error || !report) {
        warnings.push(`Report for ${g.name} not filed: ${(error?.message ?? 'no row').slice(0, 160)}`)
        continue
      }
      budget--
      filed++
      // Every open row of the upgrade points at the new report, including rows that carried a closed one.
      await db.from('dependency_vulns').update({ report_id: (report as { id: string }).id }).eq('repo_id', repoId).eq('group_key', g.key).eq('status', 'open')
    }
    if (capped > 0) warnings.push(`${capped} more report${capped === 1 ? '' : 's'} wait for tomorrow (limit ${limit} a day; Settings or App health → Known holes).`)
  }

  const run = await record(sha, {
    lockfiles: outcome.lockfiles.slice(0, MAX_LOCKFILES),
    // What runs first (exact, then lines), floors last.
    runtimes: [...outcome.pins].sort((a, b) => Number(FLOOR_PINS.has(a.how)) - Number(FLOOR_PINS.has(b.how)) || Number(b.exact) - Number(a.exact))
      .slice(0, 20).map((p: RuntimePin) => ({ runtime: p.runtime, version: p.version, exact: p.exact, floor: FLOOR_PINS.has(p.how), source: p.source })),
    packages: installed.length,
    matches: matches.length,
    groups: outcome.groups.length,
    filed,
    capped,
  })
  vlog.info('vuln-watch run', { projectId, lockfiles: outcome.lockfiles.length, packages: installed.length, matches: matches.length, filed, capped })
  return { status: run.status, runId: run.runId, commitSha: sha, lockfiles: outcome.lockfiles.length, packages: installed.length, matches: matches.length, groups: outcome.groups.length, filed, capped, warnings }
}
