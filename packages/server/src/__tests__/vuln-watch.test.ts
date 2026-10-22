/**
 * FILE: vuln-watch.test.ts
 * PURPOSE: The deterministic half of known-vulnerability checks (ADR 0038):
 *          the OSV client and advisory parsing, CVSS v3.1 scores, version
 *          order and fixed versions, the KEV / EPSS / endoflife.date parsers,
 *          runtime pins and the curated runtime table, severity, grouping,
 *          the plain-English report, the radar results, and the ADR 0035
 *          lockfile carve-out. Fixtures under fixtures/vulns are real API
 *          responses (read 2026-10-22), trimmed.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  compareVersions,
  cvss3BaseScore,
  fixedVersionFor,
  normalizeAdvisory,
  OsvError,
  queryOsvBatch,
  readJsonCapped,
  type Fetcher,
} from '../../supabase/functions/_shared/osv.ts'
import { parseEndOfLife, parseEpss, parseKev, fetchEpss } from '../../supabase/functions/_shared/vuln-feeds.ts'
import { cycleOf, detectRuntimes, rangeFloor } from '../../supabase/functions/_shared/runtime-detect.ts'
import { CURATED_RUNTIME_ADVISORIES, matchRuntimeAdvisory, mergeRuntimeAdvisories, runtimeAdvisoryFromRow } from '../../supabase/functions/_shared/runtime-advisories.ts'
import { endOfLifePins, groupMatches, radarResults, reportForGroup, severityFor, type ScanOutcome, type VulnMatch } from '../../supabase/functions/_shared/vuln-watch.ts'
import { lockfileAllowance, type PrFile } from '../../supabase/functions/_shared/fix-verify.ts'

const FIX = resolve(__dirname, 'fixtures/vulns')
const fixture = (name: string) => JSON.parse(readFileSync(resolve(FIX, name), 'utf8'))

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

// ── CVSS ─────────────────────────────────────────────────────────────────────

describe('cvss3BaseScore (FIRST CVSS v3.1 §7)', () => {
  it.each([
    ['CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H', 9.8],
    ['CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H', 10],
    ['CVSS:3.1/AV:N/AC:L/PR:H/UI:N/S:U/C:H/I:H/A:H', 7.2],
    ['CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:C/C:L/I:L/A:N', 6.4],
    ['CVSS:3.0/AV:L/AC:H/PR:N/UI:R/S:U/C:L/I:N/A:N', 2.5],
    ['CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:N', 0],
  ])('%s → %s', (vector, score) => {
    expect(cvss3BaseScore(vector)).toBe(score)
  })

  it('answers null for v2, v4 and malformed vectors', () => {
    expect(cvss3BaseScore('CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N')).toBeNull()
    expect(cvss3BaseScore('AV:N/AC:L/Au:N/C:P/I:P/A:P')).toBeNull()
    expect(cvss3BaseScore('CVSS:3.1/AV:X/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H')).toBeNull()
  })
})

// ── versions and advisories ──────────────────────────────────────────────────

describe('compareVersions', () => {
  it('orders numeric parts numerically and pre-releases before releases', () => {
    expect(compareVersions('1.10.0', '1.9.9')).toBeGreaterThan(0)
    expect(compareVersions('1.2.0-rc.1', '1.2.0')).toBeLessThan(0)
    expect(compareVersions('2.0.0rc1', '2.0.0')).toBeLessThan(0)
    expect(compareVersions('1.0.post1', '1.0')).toBeGreaterThan(0)
    expect(compareVersions('v1.2.3', '1.2.3')).toBe(0)
    expect(compareVersions('8.3', '8.10')).toBeLessThan(0)
  })
})

describe('normalizeAdvisory', () => {
  it('keeps ids, CVEs, the label, a computed score and the affected ranges', () => {
    const a = normalizeAdvisory(fixture('osv-vuln-GHSA-35jh-r3h4-6jhm.json'))!
    expect(a.id).toBe('GHSA-35jh-r3h4-6jhm')
    expect(a.cveIds).toEqual(['CVE-2021-23337'])
    expect(a.severityLabel).toBe('HIGH')
    expect(a.cvssScore).toBe(7.2)
    expect(a.url).toBe('https://osv.dev/vulnerability/GHSA-35jh-r3h4-6jhm')
    expect(a.detailsExcerpt.length).toBeLessThanOrEqual(600)
    expect(a.disputed).toBe(false)
    expect(a.affected.find((x) => x.name === 'lodash')?.ranges[0].events).toEqual([{ introduced: '0' }, { fixed: '4.17.21' }])
  })

  it('reads the Bitnami runtime record OSV added for php2shell', () => {
    const a = normalizeAdvisory(fixture('osv-vuln-BIT-php-2026-109618.json'))!
    expect(a.cveIds).toEqual(['CVE-2026-109618'])
    expect(a.severityLabel).toBe('Critical')
    expect(a.affected[0]).toMatchObject({ ecosystem: 'Bitnami', name: 'php' })
  })

  it('marks an NVD-disputed record and drops GIT ranges', () => {
    const a = normalizeAdvisory({
      id: 'CVE-2025-48757', summary: '', details: '** DISPUTED ** Lovable through 2025-04-15 lacks row level security…', aliases: [],
      affected: [{ package: { ecosystem: 'npm', name: 'x' }, ranges: [{ type: 'GIT', events: [{ introduced: 'abc' }] }] }],
    })!
    expect(a.disputed).toBe(true)
    expect(a.affected[0].ranges).toEqual([])
    expect(normalizeAdvisory({ summary: 'no id' })).toBeNull()
  })
})

describe('fixedVersionFor', () => {
  const lodash = normalizeAdvisory(fixture('osv-vuln-GHSA-35jh-r3h4-6jhm.json'))!
  const php = normalizeAdvisory(fixture('osv-vuln-BIT-php-2026-109618.json'))!

  it('finds the fix of the range the version sits in', () => {
    expect(fixedVersionFor(lodash, 'npm', 'lodash', '4.17.15')).toBe('4.17.21')
    expect(fixedVersionFor(php, 'Bitnami', 'php', '8.3.30')).toBe('8.3.36')
    expect(fixedVersionFor(php, 'Bitnami', 'php', '8.5.11')).toBe('8.5.12')
  })

  it('crosses to a later line when the old line has no fix (PHP 8.1 → 8.2.35)', () => {
    expect(fixedVersionFor(php, 'Bitnami', 'php', '8.1.20')).toBe('8.2.35')
  })

  it('answers null when only last_affected is known, or for another package', () => {
    expect(fixedVersionFor(lodash, 'npm', 'lodash.template', '4.4.0')).toBeNull()
    expect(fixedVersionFor(lodash, 'npm', 'underscore', '1.0.0')).toBeNull()
  })
})

// ── OSV client ───────────────────────────────────────────────────────────────

describe('queryOsvBatch', () => {
  it('returns ids per query in order and follows next_page_token for that query only', async () => {
    const calls: Array<{ queries: Array<{ package: { name: string }; page_token?: string }> }> = []
    const fetcher: Fetcher = async (_url, init) => {
      const body = JSON.parse(String(init?.body))
      calls.push(body)
      if (calls.length === 1) {
        return jsonResponse({ results: [{ vulns: [{ id: 'A-1', modified: 'm1' }], next_page_token: 'tok' }, {}] })
      }
      return jsonResponse({ results: [{ vulns: [{ id: 'A-2', modified: 'm2' }] }] })
    }
    const out = await queryOsvBatch([{ ecosystem: 'npm', name: 'a', version: '1.0.0' }, { ecosystem: 'npm', name: 'b', version: '1.0.0' }], fetcher)
    expect(out).toEqual([[{ id: 'A-1', modified: 'm1' }, { id: 'A-2', modified: 'm2' }], []])
    expect(calls[1].queries).toHaveLength(1)
    expect(calls[1].queries[0]).toMatchObject({ package: { name: 'a' }, page_token: 'tok' })
  })

  it('throws on a failed request or a short answer: never "no holes"', async () => {
    await expect(queryOsvBatch([{ ecosystem: 'npm', name: 'a', version: '1.0.0' }], async () => jsonResponse({}, 503))).rejects.toThrow(OsvError)
    await expect(queryOsvBatch([{ ecosystem: 'npm', name: 'a', version: '1.0.0' }], async () => jsonResponse({ results: [] }))).rejects.toThrow(/different number/)
  })

  it('sends only ecosystem, name and version', async () => {
    let sent = ''
    await queryOsvBatch([{ ecosystem: 'npm', name: 'a', version: '1.0.0' }], async (_u, init) => {
      sent = String(init?.body)
      return jsonResponse({ results: [{}] })
    })
    expect(JSON.parse(sent)).toEqual({ queries: [{ package: { name: 'a', ecosystem: 'npm' }, version: '1.0.0' }] })
  })

  it('refuses a body over the byte cap', async () => {
    const big = new Response('x'.repeat(2048))
    await expect(readJsonCapped(big, 1024)).rejects.toThrow(/byte cap/)
  })
})

// ── feeds ────────────────────────────────────────────────────────────────────

describe('feeds', () => {
  it('parses CISA KEV, keeping CVE ids and dates only', () => {
    const kev = parseKev(fixture('cisa-kev-sample.json'))
    expect(kev.catalogVersion).toBe('2026.10.21')
    expect(kev.entries.map((e) => e.cveId)).toEqual(['CVE-2022-22965', 'CVE-2021-44228'])
    expect(kev.entries[1].dateAdded).toBe('2021-12-10')
    expect(() => parseKev({})).toThrow()
  })

  it('parses EPSS and batches requests', async () => {
    expect(parseEpss(fixture('epss-response.json'))).toEqual([
      { cveId: 'CVE-2021-44228', epss: 0.99999, percentile: 1, date: '2026-10-21' },
      { cveId: 'CVE-2021-23337', epss: 0.21333, percentile: 0.97595, date: '2026-10-21' },
    ])
    const urls: string[] = []
    const ids = Array.from({ length: 120 }, (_v, i) => `CVE-2026-${10000 + i}`)
    await fetchEpss([...ids, 'GHSA-not-a-cve'], async (url) => {
      urls.push(url)
      return jsonResponse({ data: [] })
    })
    expect(urls).toHaveLength(3)
    expect(urls.every((u) => !u.includes('GHSA'))).toBe(true)
  })

  it('parses endoflife.date API v1', () => {
    const lines = parseEndOfLife(fixture('endoflife-php-v1.json'))
    expect(lines.find((l) => l.cycle === '8.3')).toMatchObject({ isEol: false, latest: '8.3.35' })
    expect(lines.find((l) => l.cycle === '8.1')).toMatchObject({ isEol: true })
    expect(() => parseEndOfLife([{ cycle: '8.3' }])).toThrow(/result.releases/)
  })
})

// ── runtime pins ─────────────────────────────────────────────────────────────

describe('detectRuntimes', () => {
  it('reads exact pins and lines from the usual files', () => {
    const pins = detectRuntimes({
      Dockerfile: 'ARG PHP_VERSION=8.3.30\nFROM --platform=linux/amd64 php:${PHP_VERSION}-fpm-alpine AS base\nFROM node:20-alpine AS assets\n',
      'web/.nvmrc': 'v20.11.1\n',
      '.tool-versions': 'nodejs 22.4.0\npython 3.12\n',
      'composer.json': JSON.stringify({ require: { php: '^8.1' }, config: { platform: { php: '8.3.30' } } }),
      'go.mod': 'module x\n\ngo 1.22\n\ntoolchain go1.22.3\n',
      'package.json': JSON.stringify({ engines: { node: '>=18 <21' } }),
      'node_modules/x/.nvmrc': '12.0.0',
    })
    const view = pins.map((p) => `${p.runtime} ${p.version} ${p.exact ? 'exact' : 'line'} ${p.how} ${p.source}${p.line ? `:${p.line}` : ''}`)
    expect([...view].sort()).toEqual([
      'go 1.22 line go_directive go.mod:3',
      'go 1.22.3 exact go_toolchain go.mod:5',
      'node 18 line engines package.json:1',
      'node 20 line dockerfile Dockerfile:3',
      'node 20.11.1 exact nvmrc web/.nvmrc:1',
      'node 22.4.0 exact tool_versions .tool-versions:1',
      'php 8.1 line composer_require composer.json:1',
      'php 8.3.30 exact composer_platform composer.json:1',
      'php 8.3.30 exact dockerfile Dockerfile:2',
      'python 3.12 line tool_versions .tool-versions:2',
    ])
    expect(pins).toHaveLength(10)
    expect(pins.find((p) => p.source.startsWith('node_modules'))).toBeUndefined()
  })

  it('ignores images that are not a runtime and tags that are not versions', () => {
    expect(detectRuntimes({ Dockerfile: 'FROM nginx:1.27.0\nFROM node:lts\nFROM php@sha256:abc\nFROM registry.example.com:5000/app\n' })).toEqual([])
  })

  it('takes the floor of a range and the line of a version', () => {
    expect(rangeFloor('^8.1 || ^8.2')).toBe('8.1')
    expect(rangeFloor('>=3.10,<4')).toBe('3.10')
    expect(cycleOf('node', '20.11.1')).toBe('20')
    expect(cycleOf('php', '8.3.30')).toBe('8.3')
    expect(cycleOf('php', '8')).toBeNull()
  })
})

describe('curated runtime advisories', () => {
  const php2shell = CURATED_RUNTIME_ADVISORIES.find((a) => a.id === 'MUSHI-RT-2026-php2shell')!

  it('matches php2shell by release line', () => {
    expect(matchRuntimeAdvisory(php2shell, '8.3.30')).toEqual({ affected: true, fixedVersion: '8.3.36' })
    expect(matchRuntimeAdvisory(php2shell, '8.3.36')).toEqual({ affected: false, fixedVersion: null })
    expect(matchRuntimeAdvisory(php2shell, '8.1.31')).toEqual({ affected: true, fixedVersion: '8.2.35' })
    expect(matchRuntimeAdvisory(php2shell, '7.4.33')).toEqual({ affected: true, fixedVersion: '8.2.35' })
    expect(matchRuntimeAdvisory(php2shell, '8.6.0')).toEqual({ affected: false, fixedVersion: null })
  })

  it('lets a table row replace a code row of the same id, and refuses malformed rows', () => {
    const row = runtimeAdvisoryFromRow({ id: php2shell.id, runtime: 'php', title: 'edited', severity: 'critical', fixed_in: ['8.3.37'], cve_ids: [], mitigations: [] })!
    expect(mergeRuntimeAdvisories([row]).find((a) => a.id === php2shell.id)?.title).toBe('edited')
    expect(runtimeAdvisoryFromRow({ id: 'x', runtime: 'ruby', title: 't', severity: 'high', fixed_in: ['1.0.0'] })).toBeNull()
    expect(runtimeAdvisoryFromRow({ id: 'x', runtime: 'php', title: 't', severity: 'high', fixed_in: [] })).toBeNull()
  })
})

// ── severity, grouping, report ───────────────────────────────────────────────

function match(over: Partial<VulnMatch> = {}): VulnMatch {
  return {
    kind: 'package', ecosystem: 'npm', name: 'lodash', version: '4.17.15', dev: false, direct: true, sourcePath: 'package-lock.json', sourceLine: null,
    lockfileKind: 'npm', runtime: null, advisoryId: 'GHSA-35jh-r3h4-6jhm', aliases: ['CVE-2021-23337'], cveIds: ['CVE-2021-23337'],
    title: 'Command Injection in lodash', url: 'https://osv.dev/vulnerability/GHSA-35jh-r3h4-6jhm', severityLabel: 'HIGH', cvssScore: 7.2,
    fixedVersion: '4.17.21', kev: false, epss: 0.01, imported: null, importedIn: null, disputed: false, mitigations: [], ...over,
  }
}

describe('severityFor (ADR 0038 decision 5)', () => {
  it('maps the signals to a level', () => {
    expect(severityFor(match({ dev: true, kev: true })).severity).toBe('info')
    expect(severityFor(match({ kev: true })).severity).toBe('critical')
    expect(severityFor(match({ epss: 0.2 })).severity).toBe('high')
    expect(severityFor(match({ cvssScore: 9.8 })).severity).toBe('high')
    expect(severityFor(match({ cvssScore: null, severityLabel: 'CRITICAL' })).severity).toBe('high')
    expect(severityFor(match()).severity).toBe('medium')
    expect(severityFor(match({ cvssScore: null, severityLabel: 'LOW' })).severity).toBe('low')
  })

  it('raises an imported package one level and never lowers for "not imported"', () => {
    expect(severityFor(match({ imported: true })).severity).toBe('high')
    expect(severityFor(match({ imported: true, epss: 0.5 })).severity).toBe('critical')
    expect(severityFor(match({ imported: null })).severity).toBe('medium')
    expect(severityFor(match({ imported: false })).severity).toBe('medium')
    // The reasons keep the base level's cause, not only the raise.
    expect(severityFor(match({ imported: true })).reasons).toEqual(['CVSS 7.2', 'your code imports it'])
  })
})

describe('groupMatches', () => {
  it('folds the advisories of one installed version into one upgrade, to the highest fix', () => {
    const groups = groupMatches([
      match(),
      match({ advisoryId: 'GHSA-29mw-wpgm-hmr9', fixedVersion: '4.17.19', cveIds: ['CVE-2020-28500'] }),
      match({ version: '4.17.19', sourcePath: 'web/package-lock.json', advisoryId: 'GHSA-35jh-r3h4-6jhm' }),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ key: 'package|npm|lodash|4.17.21', target: '4.17.21', installed: ['4.17.15', '4.17.19'], fileable: true })
    expect(groups[0].sources).toEqual(['package-lock.json', 'web/package-lock.json'])
  })

  it('does not file dev-only, disputed or unfixed holes', () => {
    expect(groupMatches([match({ dev: true })])[0].fileable).toBe(false)
    expect(groupMatches([match({ disputed: true })])[0].fileable).toBe(false)
    expect(groupMatches([match({ fixedVersion: null })])[0]).toMatchObject({ fileable: false, target: null, key: 'package|npm|lodash|nofix' })
  })
})

describe('reportForGroup', () => {
  const repo = { repoUrl: 'https://github.com/o/r', commitSha: 'abcdef1234567' }

  it('writes the plain-English ticket with the bump plan and the no-exploit rule', () => {
    const r = reportForGroup(groupMatches([match({ imported: true, importedIn: 'src/http.ts' })])[0], repo)
    expect(r.summary).toBe('Known security hole in lodash 4.17.15: upgrade to 4.17.21')
    expect(r.severity).toBe('high')
    expect(r.description).toContain('Your app installs lodash 4.17.15 (package-lock.json)')
    expect(r.description).toContain('src/http.ts')
    expect(r.description).toContain('In the package.json that lists it, change it to 4.17.21')
    expect(r.description).toContain('Run `npm install`')
    expect(r.description).toContain('Never edit a lockfile by hand')
    expect(r.description).toContain('Do not write exploit or proof-of-concept code')
    expect(r.description).toContain('https://osv.dev/vulnerability/GHSA-35jh-r3h4-6jhm')
    expect(r.environment).toMatchObject({ source: 'vuln-watch', kind: 'package', package: 'lodash', ecosystem: 'npm', target: '4.17.21' })
  })

  it('explains a transitive bump through its parent or an override', () => {
    const r = reportForGroup(groupMatches([match({ direct: false, lockfileKind: 'pnpm', sourcePath: 'pnpm-lock.yaml' })])[0], repo)
    expect(r.description).toContain('comes in through another package. Add it to "pnpm.overrides" in package.json so 4.17.21 or newer is installed.')
    expect(r.description).toContain('Mushi then cannot merge the PR on its own')
  })

  it('lists the vendor stopgaps for a runtime hole', () => {
    const php2shell = CURATED_RUNTIME_ADVISORIES[0]
    const r = reportForGroup(groupMatches([match({
      kind: 'runtime', ecosystem: 'runtime', name: 'php', version: '8.3.30', runtime: 'php', lockfileKind: null, sourcePath: 'Dockerfile', sourceLine: 2,
      advisoryId: php2shell.id, cveIds: php2shell.cveIds, title: php2shell.title, url: php2shell.url, severityLabel: 'CRITICAL', cvssScore: null,
      fixedVersion: '8.3.36', mitigations: php2shell.mitigations, epss: null,
    })])[0], repo)
    expect(r.summary).toBe('Known security hole in PHP 8.3.30: upgrade to 8.3.36')
    expect(r.description).toContain('Upgrade PHP to 8.3.36 or newer where it is pinned (Dockerfile)')
    expect(r.description).toContain('session.upload_progress.enabled=0')
  })
})

// ── radar ────────────────────────────────────────────────────────────────────

function outcome(over: Partial<ScanOutcome> = {}): ScanOutcome {
  return { lockfiles: ['package-lock.json'], pins: [], groups: [], eol: [], releaseLines: new Map(), packageError: null, runtimeError: null, unreadable: null, ...over }
}

describe('radarResults', () => {
  it('never reads green without having looked', () => {
    expect(radarResults(outcome({ unreadable: 'No primary GitHub repo is connected to this project.' })).map((r) => r.state)).toEqual(['unknown', 'unknown'])
    const [kvd, eol] = radarResults(outcome({ lockfiles: [] }))
    expect(kvd.state).toBe('unknown')
    expect(kvd.reason).toContain('Commit your lockfile')
    expect(eol.state).toBe('unknown')
    // Only floors (engines.node) pinned: nothing that runs to check.
    const floorsOnly = radarResults(outcome({ pins: detectRuntimes({ 'package.json': JSON.stringify({ engines: { node: '>=20.19.0' } }) }) }))[1]
    expect(floorsOnly.state).toBe('unknown')
    expect(floorsOnly.reason).toContain('Minimum versions such as engines.node are not what you run')
    expect(radarResults(outcome({ packageError: 'OSV.dev did not answer: 503' }))[0].state).toBe('error')
  })

  it('reports ok after a clean check, and findings by severity', () => {
    expect(radarResults(outcome())[0]).toMatchObject({ state: 'ok' })
    const groups = groupMatches([match({ kev: true }), match({ name: 'minimist', advisoryId: 'GHSA-x', cvssScore: 5, severityLabel: 'MODERATE' })])
    const [kvd] = radarResults(outcome({ groups }))
    expect(kvd.state).toBe('finding')
    expect(kvd.findings.map((f) => [f.message, f.severity])).toEqual([
      ['lodash 4.17.15 has 1 known security hole, and attackers already use one.', 'error'],
      ['minimist 4.17.15 has 1 known security hole.', 'warn'],
    ])
  })

  it('flags pins on an end-of-life line, an exact pin louder than a line, and never a floor', () => {
    const lines = new Map([['php' as const, parseEndOfLife(fixture('endoflife-php-v1.json'))]])
    const pins = detectRuntimes({ Dockerfile: 'FROM php:8.1.31-fpm\n', '.tool-versions': 'php 8.1\n', 'composer.json': JSON.stringify({ require: { php: '^8.1' } }) })
    expect(pins).toHaveLength(3)
    const eolPins = endOfLifePins(pins, lines)
    // composer require.php "^8.1" also allows 8.4: a floor, not what runs.
    expect(eolPins.map((e) => e.pin.how).sort()).toEqual(['dockerfile', 'tool_versions'])
    const eol = radarResults(outcome({ pins, eol: eolPins, releaseLines: lines }))[1]
    expect(eol.state).toBe('finding')
    expect(eol.findings.map((f) => f.severity).sort()).toEqual(['info', 'warn'])
    expect(eol.findings[0].fix).toMatch(/smallest step is PHP 8\.2\.\d+/)
  })
})

// ── ADR 0035 gate 5 as amended by ADR 0038 decision 8 ────────────────────────

function file(filename: string, patch = '', status = 'modified'): PrFile {
  return { filename, status, additions: 1, deletions: 1, patch }
}

describe('lockfileAllowance', () => {
  const vulnReport = { source: 'security_advisory', summary: 'Known security hole in lodash 4.17.15: upgrade to 4.17.21', environment: { kind: 'package', package: 'lodash', ecosystem: 'npm' } }

  it('allows a lockfile with the manifest it comes from', () => {
    expect(lockfileAllowance([file('package.json', '-    "axios": "1.6.0"\n+    "axios": "1.7.4"'), file('package-lock.json')], { summary: 'Bump axios to fix CVE-2026-1234' })).toEqual({ allowed: true, reason: null })
    // A workspace manifest below a root lockfile governs it too.
    expect(lockfileAllowance([file('apps/web/package.json', '+ "lodash": "4.17.21"'), file('pnpm-lock.yaml')], vulnReport).allowed).toBe(true)
  })

  it('refuses a lockfile-only change, or one for a report that is not about a dependency', () => {
    expect(lockfileAllowance([file('package-lock.json')], vulnReport)).toMatchObject({ allowed: false, reason: 'changes lockfile package-lock.json without the package.json it comes from' })
    expect(lockfileAllowance([file('web/package-lock.json'), file('package.json', '+ "lodash": "4.17.21"')], vulnReport).allowed).toBe(false)
    expect(lockfileAllowance([file('package.json', '+x'), file('package-lock.json')], { summary: 'Cart total is wrong' }).allowed).toBe(false)
  })

  it('needs the advisory package named in the manifest diff for a security report', () => {
    expect(lockfileAllowance([file('package.json', '+  "overrides": { "lodash": "4.17.21" }'), file('package-lock.json')], vulnReport).allowed).toBe(true)
    expect(lockfileAllowance([file('package.json', '+  "@types/lodash": "4.17.0"'), file('package-lock.json')], vulnReport)).toMatchObject({ allowed: false, reason: 'changes lockfile package-lock.json, but its manifest change does not name lodash' })
    const py = { source: 'security_advisory', environment: { kind: 'package', package: 'pyyaml', ecosystem: 'PyPI' } }
    expect(lockfileAllowance([file('pyproject.toml', '+    "PyYAML>=6.0.2",'), file('uv.lock')], py).allowed).toBe(true)
    expect(lockfileAllowance([file('pyproject.toml', '+    "types-PyYAML>=6",'), file('uv.lock')], py).allowed).toBe(false)
  })

  it('has nothing to say when no lockfile changed', () => {
    expect(lockfileAllowance([file('src/a.ts')], null)).toEqual({ allowed: true, reason: null })
  })
})
