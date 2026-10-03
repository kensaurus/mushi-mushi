/**
 * FILE: packages/server/supabase/functions/_shared/portfolio.ts
 * PURPOSE: Pure rules for the portfolio rollup (Plan 019 Phase P1): repeated
 *          findings across projects, Mushi SDK skew, integration holes, and
 *          the inferred project kind. No I/O; the route feeds rows in.
 *
 * "Open" finding (Plan 019 §3b): a finding from the latest completed gate run
 * per (project, gate), not allowlisted. Deliberate narrowing: `info` findings
 * are left out of the "fix once" groups, matching the recipe card's own count
 * (recipe-compose.ts `openFindingCounts`), so a group never lists noise the
 * project cards do not count.
 */

import type { FindingGroup, IntegrationHole, KindSource, ProjectKind, SdkSkewEntry } from './portfolio-types.ts'

// ── semver ───────────────────────────────────────────────────────────────────

/** Parse `1.2.3`, `1.2.3-beta.1` or `v1.2`. null for anything else. */
export function parseSemver(v: string | null | undefined): { major: number; minor: number; patch: number; pre: string | null } | null {
  if (typeof v !== 'string') return null
  const m = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(v.trim())
  if (!m) return null
  return { major: Number(m[1]), minor: Number(m[2] ?? 0), patch: Number(m[3] ?? 0), pre: m[4] ?? null }
}

/** Negative when a < b. Unparseable versions sort lowest. A pre-release sorts below its release. */
export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a)
  const pb = parseSemver(b)
  if (!pa && !pb) return 0
  if (!pa) return -1
  if (!pb) return 1
  if (pa.major !== pb.major) return pa.major - pb.major
  if (pa.minor !== pb.minor) return pa.minor - pb.minor
  if (pa.patch !== pb.patch) return pa.patch - pb.patch
  if (pa.pre === pb.pre) return 0
  if (pa.pre === null) return 1
  if (pb.pre === null) return -1
  return pa.pre < pb.pre ? -1 : 1
}

export interface SdkVersionRow {
  package: string
  version: string
  deprecated: boolean | null
}

/**
 * Latest stable version per package. `sdk_versions` keeps one row per
 * published version, so "latest" is the highest non-deprecated, non
 * pre-release semver — never the newest row by insert time.
 */
export function latestSdkVersions(rows: readonly SdkVersionRow[]): Map<string, string> {
  const out = new Map<string, string>()
  for (const r of rows) {
    if (r.deprecated) continue
    const p = parseSemver(r.version)
    if (!p || p.pre) continue
    const cur = out.get(r.package)
    if (!cur || compareSemver(r.version, cur) > 0) out.set(r.package, r.version)
  }
  return out
}

export interface SdkObservationRow {
  project_id: string
  sdk_package: string
  sdk_version: string | null
}

/**
 * Mushi SDK version per project and package against the latest for the SAME
 * package (never across packages). A project with no observation gets one
 * `unknown` entry; a package missing from the catalog is `unknown` too.
 */
export function sdkSkew(projectIds: readonly string[], observations: readonly SdkObservationRow[], latest: ReadonlyMap<string, string>): SdkSkewEntry[] {
  const out: SdkSkewEntry[] = []
  for (const projectId of projectIds) {
    const mine = observations.filter((o) => o.project_id === projectId)
    if (mine.length === 0) {
      out.push({ projectId, package: null, version: null, latest: null, status: 'unknown', reason: 'No Mushi SDK has reported from this project yet.' })
      continue
    }
    for (const o of mine) {
      const want = latest.get(o.sdk_package) ?? null
      if (!o.sdk_version || !parseSemver(o.sdk_version)) {
        out.push({ projectId, package: o.sdk_package, version: o.sdk_version, latest: want, status: 'unknown', reason: 'The SDK did not report a readable version.' })
      } else if (!want) {
        out.push({ projectId, package: o.sdk_package, version: o.sdk_version, latest: null, status: 'unknown', reason: 'No released version of this package is in the catalog yet.' })
      } else if (compareSemver(o.sdk_version, want) < 0) {
        out.push({ projectId, package: o.sdk_package, version: o.sdk_version, latest: want, status: 'behind', reason: `On ${o.sdk_version}; ${want} is out.` })
      } else {
        out.push({ projectId, package: o.sdk_package, version: o.sdk_version, latest: want, status: 'current', reason: `On the latest version (${want}).` })
      }
    }
  }
  return out
}

// ── repeated findings ────────────────────────────────────────────────────────

export interface OpenFindingRow {
  project_id: string
  gate: string
  rule_id: string
  severity: string
  message: string | null
}

const SEV_RANK: Record<string, number> = { error: 3, warn: 2, info: 1 }

/**
 * Group open findings by rule across projects. A group needs the rule to be
 * open in at least `minProjects` distinct projects. `info` is excluded (see the
 * file header). Sorted by severity, then by how many projects it touches.
 */
export function groupRepeatedFindings(rows: readonly OpenFindingRow[], minProjects = 2): FindingGroup[] {
  const byRule = new Map<string, { gate: string; projects: Set<string>; count: number; severity: FindingGroup['severity']; sample: string }>()
  for (const r of rows) {
    if (r.severity === 'info' || !SEV_RANK[r.severity]) continue
    const key = r.rule_id
    const g = byRule.get(key)
    const sev = r.severity as FindingGroup['severity']
    if (!g) {
      byRule.set(key, { gate: r.gate, projects: new Set([r.project_id]), count: 1, severity: sev, sample: r.message ?? '' })
      continue
    }
    g.projects.add(r.project_id)
    g.count++
    if (SEV_RANK[sev] > SEV_RANK[g.severity]) {
      g.severity = sev
      g.sample = r.message ?? g.sample
    }
  }
  const groups: FindingGroup[] = []
  for (const [ruleId, g] of byRule) {
    if (g.projects.size < minProjects) continue
    const projectIds = [...g.projects].sort()
    groups.push({
      ruleId,
      gate: g.gate,
      severity: g.severity,
      projectIds,
      findingCount: g.count,
      sampleMessage: g.sample.slice(0, 300),
      suggestedFix: `The ${ruleId} finding is open in ${projectIds.length} projects. Call list_portfolio_findings for the list, then in each repo: list_gate_findings with gate "${g.gate}", fix the ${ruleId} cases the same way, and open one draft PR per repo.`,
    })
  }
  return groups.sort((a, b) => SEV_RANK[b.severity] - SEV_RANK[a.severity] || b.projectIds.length - a.projectIds.length || a.ruleId.localeCompare(b.ruleId))
}

// ── integration holes ────────────────────────────────────────────────────────

export type IntegrationKey = IntegrationHole['integration']
const INTEGRATION_LABEL: Record<IntegrationKey, string> = {
  sentry: 'Sentry',
  slack: 'Slack',
  linear: 'Linear',
  supabase: 'a linked Supabase project',
  github: 'a connected GitHub repo',
}

/**
 * A project is missing an integration that MOST of its siblings have. "Most"
 * is a strict majority of the other projects (and at least 2 of them), so one
 * project trying Linear does not flag six holes.
 */
export function integrationHoles(presence: ReadonlyMap<string, ReadonlySet<IntegrationKey>>): IntegrationHole[] {
  const ids = [...presence.keys()]
  const out: IntegrationHole[] = []
  for (const integration of Object.keys(INTEGRATION_LABEL) as IntegrationKey[]) {
    const withIt = ids.filter((id) => presence.get(id)!.has(integration))
    for (const id of ids) {
      if (presence.get(id)!.has(integration)) continue
      const siblings = ids.length - 1
      const siblingsWith = withIt.length
      if (siblingsWith >= 2 && siblingsWith * 2 > siblings) {
        out.push({
          projectId: id,
          integration,
          siblingsWith,
          reason: `${siblingsWith} of your other ${siblings} projects use ${INTEGRATION_LABEL[integration]}; this one does not.`,
        })
      }
    }
  }
  return out
}

// ── kind ─────────────────────────────────────────────────────────────────────

const NATIVE_SDK = /react-native|capacitor|expo|ios|android/i

/**
 * Declared kind from the recipe manifest wins. Otherwise infer: a native SDK
 * observation means an app; any other SDK observation means a site. No
 * observation at all is unknown — never guessed.
 */
export function inferKind(declared: unknown, sdkPackages: readonly string[]): { kind: ProjectKind | null; source: KindSource } {
  if (declared === 'app' || declared === 'site' || declared === 'service' || declared === 'library' || declared === 'other') {
    return { kind: declared, source: 'declared' }
  }
  if (sdkPackages.some((p) => NATIVE_SDK.test(p))) return { kind: 'app', source: 'inferred' }
  if (sdkPackages.length > 0) return { kind: 'site', source: 'inferred' }
  return { kind: null, source: 'unknown' }
}

/** Run `fn` over `items` with at most `limit` in flight; keeps input order. */
export async function mapBounded<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}
