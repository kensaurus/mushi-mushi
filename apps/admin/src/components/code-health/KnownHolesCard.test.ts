/**
 * KnownHolesCard helpers (ADR 0038): the title and the paste-ready fix
 * prompt. The prompt states facts and the upgrade, says never to hand-edit a
 * lockfile, and never asks for exploit code.
 */
import { describe, expect, it } from 'vitest'
import { fixPrompt, groupTitle, type KnownHoleGroup } from './KnownHolesCard'

function group(over: Partial<KnownHoleGroup> = {}): KnownHoleGroup {
  return {
    groupKey: 'package|npm|lodash|4.17.21', kind: 'package', ecosystem: 'npm', package: 'lodash', installed: ['4.17.15'], target: '4.17.21',
    direct: true, dev: false, severity: 'high', kev: false, epss: 0.21, imported: true, sources: [{ path: 'package-lock.json', line: null }],
    status: 'open', dismissedReason: null, reportId: 'r1', firstSeenAt: '2026-10-22T00:00:00Z',
    advisories: [{ id: 'GHSA-35jh-r3h4-6jhm', title: 'Command Injection in lodash', url: 'https://osv.dev/vulnerability/GHSA-35jh-r3h4-6jhm', cves: ['CVE-2021-23337'], fixedVersion: '4.17.21', severity: 'high', kev: false }],
    ...over,
  }
}

describe('KnownHolesCard helpers', () => {
  it('names runtimes in plain words', () => {
    expect(groupTitle({ kind: 'runtime', package: 'php' })).toBe('PHP')
    expect(groupTitle({ kind: 'package', package: 'lodash' })).toBe('lodash')
  })

  it('writes a direct bump prompt with the no-exploit rule', () => {
    const p = fixPrompt(group())
    expect(p).toContain('lodash 4.17.15 has known security holes (GHSA-35jh-r3h4-6jhm)')
    expect(p).toContain('Change lodash to 4.17.21 in the manifest')
    expect(p).toContain('Do not edit the lockfile by hand')
    expect(p).toContain('Do not write exploit or proof-of-concept code')
  })

  it('writes the override path for a transitive package and the pin path for a runtime', () => {
    expect(fixPrompt(group({ direct: false }))).toContain('add an override in the manifest (npm "overrides", pnpm "pnpm.overrides", yarn "resolutions") so 4.17.21 or newer is installed')
    expect(fixPrompt(group({ kind: 'runtime', package: 'php', installed: ['8.3.30'], target: '8.3.36', sources: [{ path: 'Dockerfile', line: 1 }] })))
      .toContain('Upgrade PHP to 8.3.36 or newer where it is pinned (Dockerfile)')
  })
})
