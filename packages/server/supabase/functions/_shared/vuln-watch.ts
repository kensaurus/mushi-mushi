/**
 * FILE: packages/server/supabase/functions/_shared/vuln-watch.ts
 * PURPOSE: The deterministic half of known-vulnerability checks (ADR 0038):
 *          severity, the filing rule, grouping, the plain-English report and
 *          the radar results. No I/O; vuln-watch-db.ts reads and writes.
 *
 * Facts here are code, never a model (ADR 0039 decision 2): which version is
 * installed, which advisory matches it and what fixes it. A model only sees
 * the result when someone sends the report to an agent.
 */

import type { LockfileKind } from './lockfiles/types.ts'
import type { DetectorResult, RadarFinding, RadarSeverity } from './radar/types.ts'
import type { ReleaseLine } from './vuln-feeds.ts'
import { RUNTIME_LABEL } from './runtime-advisories.ts'
import { compareVersions } from './osv.ts'
import { FLOOR_PINS, type Runtime, type RuntimePin } from './runtime-detect.ts'

export type VulnSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info'

/** One installed thing matched to one advisory. */
export interface VulnMatch {
  kind: 'package' | 'runtime'
  /** OSV ecosystem (`npm`, `Packagist`, `PyPI`, `Go`, `Bitnami`) or `runtime` for a curated row. */
  ecosystem: string
  /** Package name, or the runtime (`php`, `node`, `python`, `go`). */
  name: string
  version: string
  dev: boolean
  direct: boolean
  /** The lockfile (package) or the file that pins the runtime. */
  sourcePath: string
  sourceLine: number | null
  lockfileKind: LockfileKind | null
  runtime: Runtime | null
  advisoryId: string
  aliases: string[]
  cveIds: string[]
  title: string
  url: string
  severityLabel: string | null
  cvssScore: number | null
  fixedVersion: string | null
  kev: boolean
  epss: number | null
  /** Seen in the app's indexed code (true), or not decided (null). Never "provably not". */
  imported: boolean | null
  importedIn: string | null
  disputed: boolean
  mitigations: string[]
  /**
   * An in-force `[[IgnoredVulns]]` entry in the repo's own `osv-scanner.toml`
   * covers this advisory (vuln-exceptions.ts): still matched, stored and
   * shown on the radar, never filed as a report.
   */
  ignored?: boolean
}

const ORDER: VulnSeverity[] = ['info', 'low', 'medium', 'high', 'critical']
export const severityRank = (s: VulnSeverity) => ORDER.indexOf(s)

/**
 * ADR 0038 decision 5. Dev-only → info. Known exploited → critical. EPSS ≥
 * 0.1, CVSS ≥ 9 or the source's CRITICAL label → high. LOW label → low.
 * Otherwise medium. Imported in the app's code → one level up. "Not
 * imported" never lowers a level: the index holds 600-character previews,
 * which cannot prove a package unused.
 */
export function severityFor(m: Pick<VulnMatch, 'dev' | 'kev' | 'epss' | 'cvssScore' | 'severityLabel' | 'imported'>): { severity: VulnSeverity; reasons: string[] } {
  if (m.dev) return { severity: 'info', reasons: ['installed for development only'] }
  if (m.kev) return { severity: 'critical', reasons: ["on CISA's list of holes attackers already use"] }
  const reasons: string[] = []
  const label = (m.severityLabel ?? '').toUpperCase()
  let s: VulnSeverity = 'medium'
  if (m.epss != null && m.epss >= 0.1) {
    s = 'high'
    reasons.push(`EPSS ${(m.epss * 100).toFixed(0)}%: likely to be attacked within 30 days`)
  }
  if (m.cvssScore != null && m.cvssScore >= 9) {
    s = 'high'
    reasons.push(`CVSS ${m.cvssScore.toFixed(1)}`)
  } else if (label === 'CRITICAL') {
    s = 'high'
    reasons.push('rated critical by the advisory')
  }
  if (s === 'medium' && (label === 'LOW' || (m.cvssScore != null && m.cvssScore < 4))) {
    s = 'low'
    reasons.push(label === 'LOW' ? 'rated low by the advisory' : `CVSS ${m.cvssScore!.toFixed(1)}`)
  }
  if (s === 'medium') {
    reasons.push(m.cvssScore != null ? `CVSS ${m.cvssScore.toFixed(1)}` : m.severityLabel ? `rated ${m.severityLabel.toLowerCase()} by the advisory` : 'a known hole with no score yet')
  }
  if (m.imported === true) {
    s = ORDER[Math.min(ORDER.length - 1, severityRank(s) + 1)]
    reasons.push('your code imports it')
  }
  return { severity: s, reasons }
}

/**
 * ADR 0038 decision 4: production, a fix exists, not disputed, not info — and
 * not already excepted by the repo's own `osv-scanner.toml` (that entry is a
 * person's decision with an expiry date, so refiling it is noise).
 */
export function isFileable(m: VulnMatch, severity: VulnSeverity): boolean {
  return !m.dev && !m.ignored && m.fixedVersion != null && !m.disputed && severity !== 'info'
}

export function radarSeverity(s: VulnSeverity): RadarSeverity {
  return s === 'critical' || s === 'high' ? 'error' : s === 'medium' ? 'warn' : 'info'
}

// ── grouping ─────────────────────────────────────────────────────────────────

export interface VulnGroup {
  /** `${kind}|${ecosystem}|${name}|${target}`: one report per (package, fixed version) per repo. */
  key: string
  kind: VulnMatch['kind']
  ecosystem: string
  name: string
  /** The version that fixes every advisory in the group, or null. */
  target: string | null
  installed: string[]
  sources: string[]
  direct: boolean
  dev: boolean
  /** Every advisory in the group is excepted in the repo's `osv-scanner.toml`. */
  ignored: boolean
  runtime: Runtime | null
  lockfileKind: LockfileKind | null
  severity: VulnSeverity
  reasons: string[]
  kev: boolean
  fileable: boolean
  importedIn: string | null
  matches: Array<VulnMatch & { severity: VulnSeverity }>
}

const groupEcosystem = (m: VulnMatch) => (m.kind === 'runtime' ? 'runtime' : m.ecosystem)

/**
 * Group matches so one upgrade is one report: for each installed
 * (package, version) the target is the highest of its advisories' fixes,
 * then copies that share a target fold together.
 */
export function groupMatches(matches: readonly VulnMatch[]): VulnGroup[] {
  const targetOf = new Map<string, string | null>()
  for (const m of matches) {
    const k = `${m.kind}|${groupEcosystem(m)}|${m.name}|${m.version}`
    const prev = targetOf.has(k) ? targetOf.get(k)! : undefined
    if (m.fixedVersion == null) {
      if (prev === undefined) targetOf.set(k, null)
      continue
    }
    if (prev == null || compareVersions(m.fixedVersion, prev) > 0) targetOf.set(k, m.fixedVersion)
  }
  const groups = new Map<string, VulnGroup>()
  for (const m of matches) {
    const target = targetOf.get(`${m.kind}|${groupEcosystem(m)}|${m.name}|${m.version}`) ?? null
    const key = `${m.kind}|${groupEcosystem(m)}|${m.name}|${target ?? 'nofix'}`
    const { severity, reasons } = severityFor(m)
    let g = groups.get(key)
    if (!g) {
      g = {
        key, kind: m.kind, ecosystem: groupEcosystem(m), name: m.name, target, installed: [], sources: [], direct: false, dev: true, ignored: true,
        runtime: m.runtime, lockfileKind: m.lockfileKind, severity: 'info', reasons: [], kev: false, fileable: false, importedIn: null, matches: [],
      }
      groups.set(key, g)
    }
    if (!g.installed.includes(m.version)) g.installed.push(m.version)
    if (!g.sources.includes(m.sourcePath)) g.sources.push(m.sourcePath)
    g.direct ||= m.direct
    g.dev &&= m.dev
    g.ignored &&= m.ignored === true
    g.kev ||= m.kev
    g.importedIn ??= m.importedIn
    if (severityRank(severity) > severityRank(g.severity)) {
      g.severity = severity
      g.reasons = reasons
    }
    g.fileable ||= isFileable(m, severity)
    g.matches.push({ ...m, severity })
  }
  for (const g of groups.values()) {
    g.installed.sort(compareVersions)
    g.matches.sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || a.advisoryId.localeCompare(b.advisoryId))
  }
  return [...groups.values()].sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || a.name.localeCompare(b.name))
}

// ── the report ───────────────────────────────────────────────────────────────

const INSTALL_COMMAND: Record<LockfileKind, string> = {
  npm: 'npm install',
  pnpm: 'pnpm install',
  yarn: 'yarn install',
  composer: 'composer update',
  poetry: 'poetry lock',
  uv: 'uv lock',
  requirements: 'pip install -r',
  gosum: 'go mod tidy',
}

const OVERRIDE_HOW: Record<LockfileKind, string> = {
  npm: 'add it to "overrides" in package.json',
  pnpm: 'add it to "pnpm.overrides" in package.json',
  yarn: 'add it to "resolutions" in package.json',
  composer: 'require it directly in composer.json with a constraint that allows only the fixed version or newer',
  poetry: 'add it as a direct dependency in pyproject.toml with the fixed version as the floor',
  uv: 'add it to [tool.uv] override-dependencies in pyproject.toml',
  requirements: 'pin it in the requirements file',
  gosum: 'run `go get <module>@v<version>`',
}

const MANIFEST_OF: Record<LockfileKind, string> = {
  npm: 'the package.json that lists it', pnpm: 'the package.json that lists it', yarn: 'the package.json that lists it', composer: 'composer.json', poetry: 'pyproject.toml', uv: 'pyproject.toml', requirements: 'the requirements file', gosum: 'go.mod',
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

function fixPlan(g: VulnGroup): string[] {
  const target = g.target!
  if (g.kind === 'runtime') {
    const label = RUNTIME_LABEL[g.runtime ?? 'php'] ?? g.name
    const steps = [`Upgrade ${label} to ${target} or newer where it is pinned (${g.sources.join(', ')}), rebuild and redeploy. If the pin is a container image tag, change the tag and rebuild the image.`]
    const mitigations = [...new Set(g.matches.flatMap((m) => m.mitigations))]
    if (mitigations.length) steps.push(`Until the upgrade is live, the vendor's stopgaps (they reduce exposure; they do not fix it):\n${mitigations.map((x) => `   - ${x}`).join('\n')}`)
    return steps
  }
  const kind = g.lockfileKind ?? 'npm'
  const lockfiles = g.sources.join(', ')
  if (kind === 'requirements') {
    return [`Change the pin to \`${g.name}==${target}\` in ${lockfiles}, then reinstall.`]
  }
  if (g.direct) {
    const pkgCommand = kind === 'gosum' ? `go get ${g.name}@v${target} && go mod tidy` : kind === 'uv' ? `uv lock --upgrade-package ${g.name}` : kind === 'composer' ? `composer update ${g.name}` : INSTALL_COMMAND[kind]
    return [
      `${g.name} is a direct dependency. In ${MANIFEST_OF[kind]}, change it to ${target} (or a range whose lowest version is ${target}).`,
      `Run \`${pkgCommand}\` so the package manager rewrites ${lockfiles}. Never edit a lockfile by hand.`,
    ]
  }
  // An override names the vulnerable package in the manifest, so verified
  // merge can prove the fix (ADR 0038 decision 8); a parent upgrade is the
  // tidier fix but needs a person to merge it.
  const how = OVERRIDE_HOW[kind].replace('<module>', g.name).replace('<version>', target)
  return [
    `${g.name} comes in through another package. ${how[0].toUpperCase()}${how.slice(1)} so ${target} or newer is installed. (Upgrading the package that pulls it in also works; Mushi then cannot merge the PR on its own.)`,
    `Run \`${INSTALL_COMMAND[kind]}\` so the package manager rewrites ${lockfiles}. Never edit a lockfile by hand.`,
  ]
}

export interface VulnReport {
  summary: string
  description: string
  severity: 'critical' | 'high' | 'medium' | 'low'
  component: string
  tags: string[]
  environment: Record<string, unknown>
}

/** The plain-English report for one fileable group (no model call, ADR 0038 decision 6). */
export function reportForGroup(g: VulnGroup, repo: { repoUrl: string; commitSha: string }): VulnReport {
  const fileable = g.matches.filter((m) => m.fixedVersion != null && !m.dev && !m.ignored && !m.disputed)
  const label = g.kind === 'runtime' ? RUNTIME_LABEL[g.runtime ?? 'php'] ?? g.name : g.name
  const installed = g.installed.join(', ')
  const n = fileable.length
  const summary = `Known security ${n === 1 ? 'hole' : 'holes'} in ${label} ${installed}: upgrade to ${g.target}`
  const lines: string[] = []
  lines.push(
    g.kind === 'runtime'
      ? `Your app runs on ${label} ${installed} (pinned in ${g.sources.join(', ')}), and that version has ${plural(n, 'known security hole')}. ${label} ${g.target} fixes ${n === 1 ? 'it' : 'all of them'}.`
      : `Your app installs ${g.name} ${installed} (${g.sources.join(', ')}), and that version has ${plural(n, 'known security hole')}. Version ${g.target} fixes ${n === 1 ? 'it' : 'all of them'}.`,
  )
  if (g.importedIn) lines.push(`Your code imports it, for example in ${g.importedIn}.`)
  lines.push('', 'What the advisories say:')
  for (const m of fileable.slice(0, 10)) {
    const ids = [m.advisoryId, ...m.cveIds.filter((c) => c !== m.advisoryId)].slice(0, 3).join(', ')
    const flags = [m.kev ? 'attackers already use it' : null, m.epss != null ? `EPSS ${(m.epss * 100).toFixed(1)}%` : null, m.cvssScore != null ? `CVSS ${m.cvssScore.toFixed(1)}` : m.severityLabel ? `rated ${m.severityLabel.toLowerCase()}` : null].filter(Boolean).join('; ')
    lines.push(`- ${m.title || ids} (${ids})${flags ? ` — ${flags}` : ''}. ${m.url}`)
  }
  if (fileable.length > 10) lines.push(`- and ${fileable.length - 10} more.`)
  lines.push('', `Why ${g.severity}: ${g.reasons.join('; ') || 'a known hole in a production dependency with a fix available'}.`)
  lines.push('', 'How to fix:')
  fixPlan(g).forEach((s, i) => lines.push(`${i + 1}. ${s}`))
  lines.push(`${fixPlan(g).length + 1}. Run the app's tests and build.`)
  lines.push('', 'Do not write exploit or proof-of-concept code for these advisories. A test that the installed version is now the fixed one is enough.')
  lines.push('', `Found by Mushi from ${repo.repoUrl} at ${repo.commitSha.slice(0, 7)}. Advisory data: OSV.dev (GitHub, PyPI and Go databases under CC-BY 4.0), CISA KEV, FIRST EPSS.`)
  return {
    summary: summary.slice(0, 200),
    description: lines.join('\n').slice(0, 8000),
    severity: g.severity === 'info' ? 'low' : g.severity,
    component: label,
    tags: ['security_advisory', g.kind === 'runtime' ? `runtime:${g.runtime}` : g.ecosystem, ...fileable.slice(0, 5).map((m) => m.advisoryId)],
    environment: {
      source: 'vuln-watch',
      groupKey: g.key,
      kind: g.kind,
      ecosystem: g.ecosystem,
      package: g.name,
      installed: g.installed,
      target: g.target,
      direct: g.direct,
      sources: g.sources,
      advisories: fileable.map((m) => ({ id: m.advisoryId, cves: m.cveIds, url: m.url, kev: m.kev, epss: m.epss })),
      commitSha: repo.commitSha,
    },
  }
}

// ── radar ────────────────────────────────────────────────────────────────────

export interface EolFinding {
  pin: RuntimePin
  line: ReleaseLine
}

/** Pins of what runs (not floors, FLOOR_PINS) whose release line is past end of life. */
export function endOfLifePins(pins: readonly RuntimePin[], lines: ReadonlyMap<Runtime, ReleaseLine[]>): EolFinding[] {
  const out: EolFinding[] = []
  for (const p of pins) {
    if (FLOOR_PINS.has(p.how)) continue
    const line = p.cycle ? lines.get(p.runtime)?.find((l) => l.cycle === p.cycle) : undefined
    if (line?.isEol) out.push({ pin: p, line })
  }
  return out
}

function supportedTarget(runtime: Runtime, lines: ReadonlyMap<Runtime, ReleaseLine[]>): string | null {
  const supported = (lines.get(runtime) ?? []).filter((l) => !l.isEol && l.latest)
  // The oldest supported line: the smallest upgrade that is still patched.
  supported.sort((a, b) => compareVersions(a.cycle, b.cycle))
  return supported[0]?.latest ?? null
}

export interface ScanOutcome {
  /** Lockfiles read (path), and runtime pins found. */
  lockfiles: string[]
  pins: RuntimePin[]
  groups: VulnGroup[]
  eol: EolFinding[]
  releaseLines: ReadonlyMap<Runtime, ReleaseLine[]>
  /** Why a part could not run; set → that rule reads `error` / `unknown`. */
  packageError: string | null
  runtimeError: string | null
  /** No repo or token: nothing to read. */
  unreadable: string | null
}

const KVD = 'known_vulnerable_dependency' as const
const EOL = 'runtime_end_of_life' as const

/** The two radar rules this scan answers (never green without having looked). */
export function radarResults(o: ScanOutcome): DetectorResult[] {
  if (o.unreadable) {
    return [
      { ruleId: KVD, state: 'unknown', reason: `Not checked: ${o.unreadable}`, findings: [] },
      { ruleId: EOL, state: 'unknown', reason: `Not checked: ${o.unreadable}`, findings: [] },
    ]
  }
  const findings: RadarFinding[] = o.groups.map((g) => {
    const label = g.kind === 'runtime' ? RUNTIME_LABEL[g.runtime ?? 'php'] ?? g.name : g.name
    const n = g.matches.length
    const what = `${label} ${g.installed.join(', ')} has ${plural(n, 'known security hole')}`
    const fix = g.target
      ? `${g.kind === 'runtime' ? 'Upgrade' : g.direct ? 'Upgrade' : 'Upgrade (through its parent or an override)'} ${label} to ${g.target}.${g.dev ? ' Dev-only, so it does not ship to users.' : ''}${g.ignored ? ' Your osv-scanner.toml excepts it, so no report was filed.' : ''}`
      : `No fixed version is published yet. Watch the advisory, or remove the dependency.${g.ignored ? ' Your osv-scanner.toml excepts it, so no report was filed.' : ''}`
    return {
      ruleId: KVD,
      severity: radarSeverity(g.severity),
      message: `${what}${g.kev ? ', and attackers already use one' : ''}.`.slice(0, 1000),
      target: g.matches[0]?.url ?? null,
      filePath: g.sources[0] ?? null,
      line: g.kind === 'runtime' ? g.matches[0]?.sourceLine ?? null : null,
      fix,
      evidence: { groupKey: g.key, severity: g.severity, advisories: g.matches.slice(0, 20).map((m) => m.advisoryId), target: g.target, dev: g.dev, direct: g.direct },
    }
  })
  const kvd: DetectorResult = o.packageError && o.lockfiles.length === 0 && o.pins.every((p) => !p.exact)
    ? { ruleId: KVD, state: 'error', reason: `Could not check: ${o.packageError}`, findings: [] }
    : findings.length > 0
      ? { ruleId: KVD, state: 'finding', reason: `${plural(findings.length, 'upgrade')} to make.${o.packageError ? ` Part of the check failed: ${o.packageError}` : ''}`, findings }
      : o.packageError
        ? { ruleId: KVD, state: 'error', reason: `Could not finish: ${o.packageError}`, findings: [] }
        : o.lockfiles.length === 0 && !o.pins.some((p) => p.exact)
          ? { ruleId: KVD, state: 'unknown', reason: 'No lockfile or exact runtime version in the repo, so no version can be matched. Commit your lockfile (package-lock.json, pnpm-lock.yaml, yarn.lock, composer.lock, poetry.lock, uv.lock or go.sum).', findings: [] }
          : { ruleId: KVD, state: 'ok', reason: `Checked ${plural(o.lockfiles.length, 'lockfile')}${o.pins.some((p) => p.exact) ? ' and the pinned runtime' : ''} against OSV.dev; no known holes.`, findings: [] }

  let eol: DetectorResult
  const running = o.pins.filter((p) => !FLOOR_PINS.has(p.how))
  if (running.length === 0) {
    eol = { ruleId: EOL, state: 'unknown', reason: 'No runtime version pinned in the repo (Dockerfile, .nvmrc, .node-version, .tool-versions, .python-version, composer config.platform, go.mod toolchain). Minimum versions such as engines.node are not what you run, so they are not checked.', findings: [] }
  } else if (o.runtimeError) {
    eol = { ruleId: EOL, state: 'error', reason: `Could not check: ${o.runtimeError}`, findings: [] }
  } else if (o.eol.length === 0) {
    eol = { ruleId: EOL, state: 'ok', reason: `Every runtime line you pin is still supported (${[...new Set(running.map((p) => `${RUNTIME_LABEL[p.runtime]} ${p.cycle ?? p.version}`))].join(', ')}).`, findings: [] }
  } else {
    eol = {
      ruleId: EOL,
      state: 'finding',
      reason: `${plural(o.eol.length, 'runtime pin')} on an unsupported line.`,
      findings: o.eol.map(({ pin, line }) => {
        const label = RUNTIME_LABEL[pin.runtime]
        const target = supportedTarget(pin.runtime, o.releaseLines)
        return {
          ruleId: EOL,
          severity: pin.exact ? 'warn' : 'info',
          message: pin.exact
            ? `${label} ${pin.version} is on the ${pin.cycle} line, which stopped getting security fixes${line.eolFrom ? ` on ${line.eolFrom}` : ''}.`
            : `${pin.source} runs ${label} ${pin.cycle}, which stopped getting security fixes${line.eolFrom ? ` on ${line.eolFrom}` : ''}.`,
          target: `https://endoflife.date/${pin.runtime === 'node' ? 'nodejs' : pin.runtime}`,
          filePath: pin.source,
          line: pin.line,
          fix: target ? `Move to a supported line; the smallest step is ${label} ${target}.` : `Move to a supported ${label} line.`,
          evidence: { runtime: pin.runtime, version: pin.version, cycle: pin.cycle, how: pin.how, exact: pin.exact },
        }
      }),
    }
  }
  return [kvd, eol]
}
