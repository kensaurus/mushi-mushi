/**
 * FILE: apps/admin/src/components/recipe/dependencyHoles.ts
 * PURPOSE: The App blueprint's dependency holes as one table (owner, 2026-11-19: fifteen
 *          sentences of "next 16.4.2 has 2 known security holes…" each with its own copy icon).
 *          One row per upgrade: package, installed → fixed version, hole count, and the
 *          report that holds the fix. Plus one "fix all" prompt for the editor.
 *
 *          Rows come from GET /v1/admin/projects/:id/vulnerabilities (structured groups).
 *          When that read is missing (older server, failed read), they are parsed from the
 *          radar finding sentences, which vuln-watch writes in one fixed shape
 *          (`_shared/vuln-watch.ts` radarResults). Pure: no React.
 */

export type HoleSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info'

export interface HoleRow {
  key: string
  /** Package or runtime name as a person reads it ("next", "Node.js"). */
  name: string
  installed: string
  /** The version that fixes every hole; null when none is published. */
  target: string | null
  holes: number
  severity: HoleSeverity
  /** Development-only: never ships to users. */
  dev: boolean
  /** Listed in the manifest itself (false = pulled in by another package). */
  direct: boolean | null
  /** Attackers already use one of these holes (CISA KEV). */
  exploited: boolean
  /** The bug report vuln-watch filed for it; its Fix button opens the PR. */
  reportId: string | null
  /** Lockfiles / files the version is pinned in. */
  where: string[]
}

/** @internal Exported for tests only. Structured group from /vulnerabilities (the subset this table needs). */
export interface HoleGroupInput {
  groupKey: string
  kind: 'package' | 'runtime'
  package: string
  installed: string[]
  target: string | null
  direct: boolean
  dev: boolean
  severity: HoleSeverity
  kev: boolean
  status: 'open' | 'dismissed'
  reportId: string | null
  sources: Array<{ path: string }>
  advisories: unknown[]
}

/** A radar finding of the known_vulnerable_dependency check. */
interface HoleFindingInput {
  id: string
  severity: string
  message: string
  fix: string | null
  filePath: string | null
}

const RUNTIME_LABEL: Record<string, string> = { php: 'PHP', node: 'Node.js', python: 'Python', go: 'Go' }
const SEVERITY_RANK: Record<HoleSeverity, number> = { critical: 4, high: 3, medium: 2, low: 1, info: 0 }

function sortHoleRows(rows: HoleRow[]): HoleRow[] {
  return [...rows].sort(
    (a, b) =>
      Number(a.dev) - Number(b.dev) ||
      Number(b.exploited) - Number(a.exploited) ||
      SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
      b.holes - a.holes ||
      a.name.localeCompare(b.name),
  )
}

/** Open groups → rows, worst first. Dismissed groups are left out. */
export function holeRowsFromGroups(groups: readonly HoleGroupInput[]): HoleRow[] {
  return sortHoleRows(
    groups
      .filter((g) => g.status === 'open')
      .map((g) => ({
        key: g.groupKey,
        name: g.kind === 'runtime' ? RUNTIME_LABEL[g.package] ?? g.package : g.package,
        installed: g.installed.join(', '),
        target: g.target,
        holes: Math.max(1, g.advisories.length),
        severity: g.severity,
        dev: g.dev,
        direct: g.kind === 'runtime' ? null : g.direct,
        exploited: g.kev,
        reportId: g.reportId,
        where: g.sources.map((s) => s.path),
      })),
  )
}

// "next 16.4.2 has 2 known security holes, and attackers already use one."
const MESSAGE_RE = /^(.+?) (\S+(?:, \S+)*) has (\d+) known security holes?(, and attackers already use one)?\.?$/
// "Upgrade next to 16.5.0." / "Upgrade (through its parent or an override) foo to 1.2.3. Dev-only, …"
const FIX_RE = /^Upgrade (\(through its parent or an override\) )?.+? to (\S+?)\.(?:\s|$)/

function severityFromRadar(s: string): HoleSeverity {
  const v = s.toLowerCase()
  if (v === 'critical') return 'critical'
  if (v === 'error' || v === 'high') return 'high'
  if (v === 'warn' || v === 'medium') return 'medium'
  if (v === 'info') return 'info'
  return 'low'
}

/** Radar sentences → rows. A sentence in another shape is skipped (the caller lists it as text). */
export function holeRowsFromFindings(findings: readonly HoleFindingInput[]): { rows: HoleRow[]; unparsed: HoleFindingInput[] } {
  const rows: HoleRow[] = []
  const unparsed: HoleFindingInput[] = []
  for (const f of findings) {
    const m = MESSAGE_RE.exec(f.message.trim())
    if (!m) {
      unparsed.push(f)
      continue
    }
    const fix = f.fix ? FIX_RE.exec(f.fix.trim()) : null
    const dev = /Dev-only/.test(f.fix ?? '')
    rows.push({
      key: f.id,
      name: m[1]!,
      installed: m[2]!,
      target: fix ? fix[2]! : null,
      holes: Number(m[3]),
      severity: dev ? 'info' : severityFromRadar(f.severity),
      dev,
      direct: fix ? !fix[1] : null,
      exploited: Boolean(m[4]),
      reportId: null,
      where: f.filePath ? [f.filePath] : [],
    })
  }
  return { rows: sortHoleRows(rows), unparsed }
}

/**
 * One prompt for the editor that fixes every listed hole: the upgrades as a list, then the
 * rules (manifest not lockfile, overrides for transitive packages, run the tests, no exploit code).
 */
export function fixAllHolesPrompt(rows: readonly HoleRow[]): string {
  const fixable = rows.filter((r) => r.target)
  const lines = fixable.map((r) => {
    const how = r.direct === false ? ', comes in through another package: add an override or upgrade its parent' : r.direct === null ? ' (runtime: change the pinned version)' : ''
    const where = r.where.length ? ` [${r.where.join(', ')}]` : ''
    return `- ${r.name} ${r.installed} → ${r.target} (${r.holes} known hole${r.holes === 1 ? '' : 's'}${r.dev ? ', dev only' : ''}${r.exploited ? ', attackers already use one' : ''}${how})${where}`
  })
  const noFix = rows.filter((r) => !r.target).map((r) => `- ${r.name} ${r.installed}: no fixed version published yet; leave it and say so.`)
  return [
    `Mushi Mushi found known security holes in ${fixable.length} dependenc${fixable.length === 1 ? 'y' : 'ies'} of this app. Upgrade each to the version shown:`,
    lines.join('\n'),
    noFix.length ? `Not fixable yet:\n${noFix.join('\n')}` : null,
    'For a direct dependency, change its version in the manifest (package.json, pyproject.toml, composer.json, go.mod). For a package that comes in through another one, add an override (npm "overrides", pnpm "pnpm.overrides", yarn "resolutions") or upgrade the package that pulls it in. Then run the package manager\'s install so it rewrites the lockfile. Never edit a lockfile by hand.',
    'Run the build and the tests after the upgrades. Do not write exploit or proof-of-concept code.',
  ]
    .filter(Boolean)
    .join('\n\n')
}
