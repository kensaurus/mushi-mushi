/**
 * FILE: packages/server/supabase/functions/_shared/vuln-exceptions.ts
 * PURPOSE: Read the advisory exceptions a repo keeps in `osv-scanner.toml`
 *          so the known-holes check (ADR 0038) does not file a report the
 *          repo has already triaged, documented and given an expiry date.
 *
 * WHY: `osv-scanner.toml` is the file OSV-Scanner (and through it OpenSSF
 * Scorecard) reads for `[[IgnoredVulns]]`, and it has to sit next to the
 * lockfile it covers. Mushi matches the same OSV data, so an advisory a repo
 * has excepted there was already looked at by a person: refiling it every
 * day is noise, and the entry's own `ignoreUntil` is the date the question
 * reopens.
 *
 * DEPENDENCIES: `lockfiles/toml-lite.ts` (dependency-free TOML reader).
 *
 * USAGE: `vuln-watch-db.ts` parses every `osv-scanner.toml` it read from the
 * repo tree, then marks each match an in-force entry covers:
 *
 *   const rules = Object.entries(configs).flatMap(([p, t]) => parseVulnIgnores(p, t))
 *   if (ignoreFor(rules, match, now)) match.ignored = true
 *
 * TECHNICAL DETAILS:
 *   - `parseVulnIgnores(path, text)` — `[[IgnoredVulns]]` rows as rules,
 *     scoped to the config's own directory. Unparseable TOML yields none.
 *   - `ignoreFor(rules, match, now)` — the first in-force rule whose id is
 *     the match's advisory id, one of its aliases or one of its CVE ids, and
 *     whose directory contains the file the match came from.
 *
 * NOTES: An exception never hides the match — `dependency_vulns` still
 * records it and the radar finding still shows it, labelled as an accepted
 * exception. It only stops the report. An entry without `ignoreUntil` never
 * expires (OSV-Scanner's own rule); a date that is not a date is treated as
 * already expired, so a typo fails closed and the report comes back.
 */

import { arrayAt, parseTomlLite, tableAt } from './lockfiles/toml-lite.ts'

/** One `[[IgnoredVulns]]` entry, scoped to the folder its config sits in. */
export interface VulnIgnoreRule {
  /** Advisory id, alias or CVE id as written in the file (upper-cased). */
  id: string
  /** The date the exception stops applying, or null for "no expiry". */
  ignoreUntil: string | null
  reason: string | null
  /** Repo path of the `osv-scanner.toml` the entry came from. */
  configPath: string
  /** The config's folder (`''` at the repo root); it covers files under it. */
  dir: string
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

function dirOf(path: string): string {
  const i = path.lastIndexOf('/')
  return i < 0 ? '' : path.slice(0, i + 1)
}

/** `[[IgnoredVulns]]` rows of one `osv-scanner.toml`; none when it does not parse. */
export function parseVulnIgnores(configPath: string, text: string): VulnIgnoreRule[] {
  let doc: Record<string, unknown>
  try {
    doc = parseTomlLite(text)
  } catch {
    return []
  }
  const dir = dirOf(configPath)
  const out: VulnIgnoreRule[] = []
  for (const row of arrayAt(doc.IgnoredVulns as never)) {
    const t = tableAt(row as never)
    const id = typeof t.id === 'string' ? t.id.trim() : ''
    if (!id) continue
    const until = t.ignoreUntil
    out.push({
      id: id.toUpperCase(),
      ignoreUntil: typeof until === 'string' && until.trim() ? until.trim() : null,
      reason: typeof t.reason === 'string' ? t.reason : null,
      configPath,
      dir,
    })
  }
  return out
}

/**
 * Still in force at `now`? No `ignoreUntil` never expires; a date-only value
 * expires at the start of that day in UTC (the finding reopens *on* the
 * date); anything unparseable has already expired.
 */
function ignoreInForce(rule: VulnIgnoreRule, now: Date): boolean {
  if (rule.ignoreUntil == null) return true
  const raw = rule.ignoreUntil
  const ms = Date.parse(DATE_ONLY.test(raw) ? `${raw}T00:00:00Z` : raw)
  return Number.isFinite(ms) && now.getTime() < ms
}

/** The in-force entry covering this match, or null. */
export function ignoreFor(
  rules: readonly VulnIgnoreRule[],
  match: { advisoryId: string; aliases: readonly string[]; cveIds: readonly string[]; sourcePath: string },
  now: Date,
): VulnIgnoreRule | null {
  if (rules.length === 0) return null
  const ids = new Set(
    [match.advisoryId, ...match.aliases, ...match.cveIds]
      .filter((x) => typeof x === 'string' && x.trim())
      .map((x) => x.trim().toUpperCase()),
  )
  for (const rule of rules) {
    if (!ids.has(rule.id)) continue
    if (rule.dir && !match.sourcePath.startsWith(rule.dir)) continue
    if (!ignoreInForce(rule, now)) continue
    return rule
  }
  return null
}
