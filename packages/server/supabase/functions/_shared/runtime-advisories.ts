/**
 * FILE: packages/server/supabase/functions/_shared/runtime-advisories.ts
 * PURPOSE: Security holes in the language runtime itself (ADR 0038 decision
 *          2): where OSV keeps them, and a hand-kept table for the days
 *          before it does.
 *
 * OSV covers runtimes through Bitnami's database (`Bitnami` ecosystem:
 * php, node, python) and Go's own `stdlib` records (checked 2026-10-22). The
 * feeds lag: on 2026-10-21 PHP fixed "php2shell" and OSV had no record until
 * the next morning (BIT-php-2026-109618, published 2026-10-22T08:08Z).
 * CURATED_RUNTIME_ADVISORIES is that day-zero backstop; the
 * `runtime_advisories` table adds rows without a deploy. A curated row whose
 * CVEs OSV already reports for the same pin is dropped, so it never counts
 * twice.
 */

import { compareVersions } from './osv.ts'
import { cycleOf, type Runtime } from './runtime-detect.ts'

/** Where OSV keeps each runtime's own advisories. */
export const RUNTIME_OSV_PACKAGE: Readonly<Record<Runtime, { ecosystem: string; name: string }>> = {
  php: { ecosystem: 'Bitnami', name: 'php' },
  node: { ecosystem: 'Bitnami', name: 'node' },
  python: { ecosystem: 'Bitnami', name: 'python' },
  go: { ecosystem: 'Go', name: 'stdlib' },
}

export const RUNTIME_LABEL: Readonly<Record<Runtime, string>> = { php: 'PHP', node: 'Node.js', python: 'Python', go: 'Go' }

export interface RuntimeAdvisory {
  /** Stable id; `MUSHI-RT-` for curated rows. */
  id: string
  runtime: Runtime
  title: string
  cveIds: string[]
  severity: 'critical' | 'high' | 'medium' | 'low'
  /** The first fixed release of each supported line, e.g. ["8.2.35", "8.3.36"]. */
  fixedIn: string[]
  /** Vendor stopgaps until the upgrade lands (config lines, never code). */
  mitigations: string[]
  summary: string
  url: string
  published: string
}

export const CURATED_RUNTIME_ADVISORIES: readonly RuntimeAdvisory[] = [
  {
    id: 'MUSHI-RT-2026-php2shell',
    runtime: 'php',
    title: 'php2shell: unauthenticated remote code execution in PHP itself',
    cveIds: ['CVE-2026-109618', 'CVE-2026-109619'],
    severity: 'critical',
    fixedIn: ['8.2.35', '8.3.36', '8.4.27', '8.5.12'],
    // php.net security advisory, 21 Oct 2026 ("If you cannot update immediately").
    mitigations: [
      'Set memory_limit=-1 where applications cannot override it (php_admin_value in the FPM pool or Apache config), and check nothing sets a finite limit again.',
      'Set a low post_max_size (8M without uploads, 32M with them) and keep upload_max_filesize below it.',
      'Set session.upload_progress.enabled=0 in php.ini or the FPM pool, not ini_set() or .user.ini, and restart every worker.',
      'On PHP 8.5, set fatal_error_backtraces=0 and restart every worker.',
    ],
    summary: 'Two bugs in the PHP engine let an attacker run code on the server with one unauthenticated web request (PHP-FPM, mod_php, php-cgi, FrankenPHP, LiteSpeed). mod_php is the worst case. PHP 8.1 and older get no official release; the PHP team published minimal source backports for 7.4, 8.0 and 8.1.',
    url: 'https://www.php.net/',
    published: '2026-10-21',
  },
]

/**
 * Is `version` affected, and what fixes it? Same release line: affected when
 * below that line's fix. An older line than every fix: affected, and the fix
 * is the oldest line's (an upgrade across lines). A newer line: not affected.
 */
export function matchRuntimeAdvisory(adv: Pick<RuntimeAdvisory, 'runtime' | 'fixedIn'>, version: string): { affected: boolean; fixedVersion: string | null } {
  const cycle = cycleOf(adv.runtime, version)
  if (!cycle) return { affected: false, fixedVersion: null }
  const fixes = [...adv.fixedIn].sort(compareVersions)
  const sameLine = fixes.find((f) => cycleOf(adv.runtime, f) === cycle)
  if (sameLine) return compareVersions(version, sameLine) < 0 ? { affected: true, fixedVersion: sameLine } : { affected: false, fixedVersion: null }
  const oldest = fixes[0]
  if (oldest && compareVersions(cycle, cycleOf(adv.runtime, oldest) ?? oldest) < 0) return { affected: true, fixedVersion: oldest }
  return { affected: false, fixedVersion: null }
}

/** A `runtime_advisories` row → RuntimeAdvisory, or null when malformed. */
export function runtimeAdvisoryFromRow(row: Record<string, unknown>): RuntimeAdvisory | null {
  const runtime = row.runtime
  if (runtime !== 'php' && runtime !== 'node' && runtime !== 'python' && runtime !== 'go') return null
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
  const severity = row.severity
  if (severity !== 'critical' && severity !== 'high' && severity !== 'medium' && severity !== 'low') return null
  if (typeof row.id !== 'string' || typeof row.title !== 'string') return null
  const fixedIn = list(row.fixed_in)
  if (fixedIn.length === 0) return null
  return {
    id: row.id,
    runtime,
    title: row.title,
    cveIds: list(row.cve_ids),
    severity,
    fixedIn,
    mitigations: list(row.mitigations),
    summary: typeof row.summary === 'string' ? row.summary : '',
    url: typeof row.advisory_url === 'string' ? row.advisory_url : '',
    published: typeof row.published_on === 'string' ? row.published_on : '',
  }
}

/** Curated rows plus table rows, the table winning on the same id. */
export function mergeRuntimeAdvisories(rows: readonly RuntimeAdvisory[]): RuntimeAdvisory[] {
  const byId = new Map<string, RuntimeAdvisory>()
  for (const a of CURATED_RUNTIME_ADVISORIES) byId.set(a.id, a)
  for (const a of rows) byId.set(a.id, a)
  return [...byId.values()]
}
