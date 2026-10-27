/**
 * FILE: packages/server/supabase/functions/_shared/modernization-dispatch.ts
 * PURPOSE: The rules for dispatching a library-modernization finding to a fix
 *          agent, as pure functions: how big a version bump is, which
 *          findings may share one "bump the minor dependencies" report, the
 *          plain-English report text an agent is sent, and which findings
 *          are done because their report was fixed.
 *
 * WHY (measured 2026-10-22): 214 pending findings across 5 apps could not be
 * dispatched. `POST /v1/admin/modernization/:id/dispatch` needed a
 * `related_report_id`, which the modernizer only creates for major /
 * security / deprecated findings (18 of them). And 13 findings stayed
 * `pending` after their report was fixed. Dispatch now files the report
 * itself, and minor / patch bumps of one repo can go as one report.
 *
 * Older findings hold versions an LLM made up ("10.x latest", "9.x (latest
 * 9.x stable)", downgrades). Only a bump whose versions both parse, and that
 * really goes up, is filed: `classifyBump` says `unknown` or `not_upgrade`
 * otherwise, and the route refuses it.
 *
 * Pure: no Deno globals, no npm: specifiers, so vitest imports it directly.
 */

import { compareSemver, parseInstalledRange } from './modernizer-versions.ts'

/** Findings one grouped report may carry; the rest wait for the next group. */
export const MODERNIZATION_GROUP_MAX = 25
/** Report statuses that mean the work is done. */
export const FIXED_REPORT_STATUSES: readonly string[] = ['fixed', 'resolved', 'verified']
/** Finding statuses reconciliation may move to `resolved`. */
export const OPEN_FINDING_STATUSES: readonly string[] = ['pending', 'dispatched']
export const ACCEPTANCE_CHECK = 'build + typecheck + tests pass'

export type BumpKind = 'patch' | 'minor' | 'major' | 'not_upgrade' | 'unknown'

export interface ModernizationFindingRow {
  id: string
  project_id: string
  repo_id: string | null
  dep_name: string
  current_version: string | null
  suggested_version: string | null
  manifest_path: string | null
  summary: string | null
  severity: string | null
  changelog_url: string | null
  related_report_id: string | null
  status: string
  detected_at?: string | null
}

/**
 * How big the bump from the declared spec (`^1.2.3`, `~1.2.3`, `1.2.3`) to
 * the suggested version is. Pre-1.0 follows semver's caret rule: in 0.x a
 * minor change is breaking, so `0.4.2 → 0.5.0` is `major` and
 * `0.4.2 → 0.4.3` is `patch`. Anything that does not parse is `unknown`; a
 * suggestion at or below the current floor is `not_upgrade`.
 */
export function classifyBump(current: string | null | undefined, suggested: string | null | undefined): BumpKind {
  const from = parseInstalledRange(String(current ?? ''))
  const to = parseInstalledRange(String(suggested ?? ''))
  if (!from || !to) return 'unknown'
  const a = from.floor
  const b = to.floor
  if (b.prerelease.length > 0) return 'unknown'
  if (compareSemver(b, a) <= 0) return 'not_upgrade'
  if (a.major === 0) {
    if (b.major !== 0 || b.minor !== a.minor) return 'major'
    return 'patch'
  }
  if (b.major !== a.major) return 'major'
  if (b.minor !== a.minor) return 'minor'
  return 'patch'
}

export function isGroupableBump(kind: BumpKind): boolean {
  return kind === 'minor' || kind === 'patch'
}

/** The version a report names: the suggestion without its range operator. */
export function targetVersion(suggested: string | null | undefined): string {
  return String(suggested ?? '').trim().replace(/^(?:\^|~|=|>=)\s*/, '').replace(/^v/, '')
}

/** `https://github.com/owner/repo(.git)` → `owner/repo`; anything else as given, or "this repository". */
export function repoLabel(repoUrl: string | null | undefined): string {
  const url = String(repoUrl ?? '').trim()
  const m = /github\.com[/:]([^/\s]+)\/([^/\s#?]+?)(?:\.git)?\/?$/i.exec(url)
  if (m) return `${m[1]}/${m[2]}`
  return url || 'this repository'
}

/**
 * The findings that go in one "Bump N minor dependencies" report with
 * `anchor`: pending findings of the same app and repo, not yet linked to a
 * report, whose bump is minor or patch. One per package (the highest
 * target wins), sorted by name, at most MODERNIZATION_GROUP_MAX. Major,
 * unknown and non-upgrade bumps never join a group.
 */
export function selectMinorGroup(
  anchor: Pick<ModernizationFindingRow, 'project_id' | 'repo_id'>,
  candidates: ModernizationFindingRow[],
  max = MODERNIZATION_GROUP_MAX,
): ModernizationFindingRow[] {
  const best = new Map<string, ModernizationFindingRow>()
  for (const f of candidates) {
    if (f.project_id !== anchor.project_id || (f.repo_id ?? null) !== (anchor.repo_id ?? null)) continue
    if (f.status !== 'pending' || f.related_report_id) continue
    if (!isGroupableBump(classifyBump(f.current_version, f.suggested_version))) continue
    const prev = best.get(f.dep_name)
    if (!prev) {
      best.set(f.dep_name, f)
      continue
    }
    const a = parseInstalledRange(String(prev.suggested_version ?? ''))?.floor
    const b = parseInstalledRange(String(f.suggested_version ?? ''))?.floor
    if (a && b && compareSemver(b, a) > 0) best.set(f.dep_name, f)
  }
  return [...best.values()].sort((x, y) => x.dep_name.localeCompare(y.dep_name)).slice(0, max)
}

/** Findings of the same package that the group's pick for it stands in for (lower targets). */
export function shadowedByGroup(group: ModernizationFindingRow[], candidates: ModernizationFindingRow[]): string[] {
  const picked = new Map(group.map((f) => [f.dep_name, f.id]))
  const groupIds = new Set(group.map((f) => f.id))
  const anchor = group[0]
  if (!anchor) return []
  return candidates
    .filter(
      (f) =>
        !groupIds.has(f.id) &&
        picked.has(f.dep_name) &&
        f.project_id === anchor.project_id &&
        (f.repo_id ?? null) === (anchor.repo_id ?? null) &&
        f.status === 'pending' &&
        !f.related_report_id &&
        isGroupableBump(classifyBump(f.current_version, f.suggested_version)),
    )
    .map((f) => f.id)
}

export interface ModernizationReportDraft {
  summary: string
  description: string
  component: string
  severity: 'high' | 'low'
  bug_ontology_tags: string[]
  environment: Record<string, unknown>
}

function clip(text: string | null | undefined, max: number): string {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

const BUMP_WORDS: Record<BumpKind, string> = {
  patch: 'a patch update',
  minor: 'a minor update',
  major: 'a major update (it may have breaking changes)',
  not_upgrade: 'not an upgrade',
  unknown: 'an update of unknown size',
}

/** The report one finding is filed as: what to change, why, and how to know it is done. */
export function buildFindingReport(f: ModernizationFindingRow, repo: string): ModernizationReportDraft {
  const kind = classifyBump(f.current_version, f.suggested_version)
  const to = targetVersion(f.suggested_version)
  const from = String(f.current_version ?? '').trim()
  const manifest = f.manifest_path || 'package.json'
  const lines = [
    `Update the dependency ${f.dep_name} in ${repo} (${manifest}) from ${from} to ${to}. This is ${BUMP_WORDS[kind]}.`,
    '',
    ...(f.summary ? ['Why, from the library modernizer:', clip(f.summary, 1500), ''] : []),
    ...(f.changelog_url ? [`Changelog and breaking-change notes: ${f.changelog_url}`, ''] : []),
    'What to do:',
    `- Change the version of ${f.dep_name} in ${manifest} to ${to}, and update the lockfile with the package manager the repository already uses.`,
    '- Read the changelog for breaking changes between the two versions, and change the code only where the new version needs it. Nothing else.',
    '- Do not upgrade other packages unless this one requires it (a peer dependency).',
    '',
    `Done when: ${ACCEPTANCE_CHECK}.`,
  ]
  return {
    summary: clip(`Update ${f.dep_name} from ${from} to ${to}`, 200),
    description: lines.join('\n'),
    component: f.dep_name,
    severity: f.severity === 'security' ? 'high' : 'low',
    bug_ontology_tags: ['modernization', f.severity ?? 'minor'],
    environment: {
      source: 'library-modernizer',
      dispatch: 'single',
      findingId: f.id,
      changelogUrl: f.changelog_url ?? null,
      acceptance: ACCEPTANCE_CHECK,
    },
  }
}

/** One report for a group of minor / patch bumps in one repo. */
export function buildGroupReport(group: ModernizationFindingRow[], repo: string): ModernizationReportDraft {
  const n = group.length
  const noun = n === 1 ? 'dependency' : 'dependencies'
  const lines = [
    `Bump ${n} minor ${noun} in ${repo}. Each is a minor or patch update inside the same major version, so none should need code changes.`,
    '',
    'Packages:',
    ...group.map((f) => {
      const note = f.changelog_url ? ` (changelog: ${f.changelog_url})` : ''
      return `- ${f.dep_name} in ${f.manifest_path || 'package.json'}: ${String(f.current_version ?? '').trim()} → ${targetVersion(f.suggested_version)}${note}`
    }),
    '',
    'What to do:',
    '- Change each version above in its manifest and update the lockfile with the package manager the repository already uses.',
    '- If one package breaks the build or tests and the fix is not small, leave that package at its current version and say so in the pull request description.',
    '- Do not upgrade any package that is not listed.',
    '',
    `Done when: ${ACCEPTANCE_CHECK}.`,
  ]
  return {
    summary: clip(`Bump ${n} minor ${noun} in ${repo}`, 200),
    description: lines.join('\n'),
    component: 'dependencies',
    severity: 'low',
    bug_ontology_tags: ['modernization', 'minor', 'grouped'],
    environment: {
      source: 'library-modernizer',
      dispatch: 'group_minor',
      findingIds: group.map((f) => f.id),
      acceptance: ACCEPTANCE_CHECK,
    },
  }
}

/**
 * Findings that are done: open (`pending` / `dispatched`) and linked to a
 * report whose status is fixed, resolved or verified. Safe to run any number
 * of times: a resolved finding is no longer open.
 */
export function findingsToResolve(
  findings: Array<Pick<ModernizationFindingRow, 'id' | 'status' | 'related_report_id'>>,
  reportStatus: ReadonlyMap<string, string>,
): string[] {
  return findings
    .filter(
      (f) =>
        OPEN_FINDING_STATUSES.includes(f.status) &&
        !!f.related_report_id &&
        FIXED_REPORT_STATUSES.includes(reportStatus.get(f.related_report_id) ?? ''),
    )
    .map((f) => f.id)
}
