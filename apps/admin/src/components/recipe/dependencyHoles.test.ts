import { describe, expect, it } from 'vitest'
import { fixAllHolesPrompt, holeRowsFromFindings, holeRowsFromGroups, type HoleGroupInput } from './dependencyHoles'

const group = (over: Partial<HoleGroupInput>): HoleGroupInput => ({
  groupKey: 'npm|next|16.4.2|16.5.0',
  kind: 'package',
  package: 'next',
  installed: ['16.4.2'],
  target: '16.5.0',
  direct: true,
  dev: false,
  severity: 'high',
  kev: false,
  status: 'open',
  reportId: null,
  sources: [{ path: 'pnpm-lock.yaml' }],
  advisories: [{}, {}],
  ...over,
})

describe('holeRowsFromGroups', () => {
  it('keeps open groups, counts advisories as holes and sorts the worst first', () => {
    const rows = holeRowsFromGroups([
      group({ groupKey: 'a', package: 'lodash', severity: 'medium', advisories: [{}] }),
      group({ groupKey: 'b', package: 'esbuild', dev: true, severity: 'info' }),
      group({ groupKey: 'c', status: 'dismissed' }),
      group({ groupKey: 'd', package: 'next', kev: true }),
      group({ groupKey: 'e', kind: 'runtime', package: 'node', installed: ['20.1.0'], target: '20.11.1', advisories: [{}, {}, {}] }),
    ])
    expect(rows.map((r) => r.name)).toEqual(['next', 'Node.js', 'lodash', 'esbuild'])
    expect(rows[0]).toMatchObject({ installed: '16.4.2', target: '16.5.0', holes: 2, exploited: true, direct: true })
    // A runtime has no direct/transitive distinction; dev-only packages sort last.
    expect(rows[1]!.direct).toBeNull()
    expect(rows[3]!.dev).toBe(true)
  })
})

describe('holeRowsFromFindings', () => {
  it('reads the vuln-watch sentences and keeps what it cannot parse aside', () => {
    const { rows, unparsed } = holeRowsFromFindings([
      { id: '1', severity: 'error', message: 'next 16.4.2 has 2 known security holes, and attackers already use one.', fix: 'Upgrade next to 16.5.0.', filePath: 'pnpm-lock.yaml' },
      { id: '2', severity: 'warn', message: 'semver 5.7.1 has 1 known security hole.', fix: 'Upgrade (through its parent or an override) semver to 5.7.2. Dev-only, so it does not ship to users.', filePath: null },
      { id: '3', severity: 'warn', message: 'left-pad 1.0.0 has 1 known security hole.', fix: 'No fixed version is published yet. Watch the advisory, or remove the dependency.', filePath: null },
      { id: '4', severity: 'warn', message: 'Something in another shape', fix: null, filePath: null },
    ])
    expect(unparsed.map((f) => f.id)).toEqual(['4'])
    expect(rows.map((r) => r.name)).toEqual(['next', 'left-pad', 'semver'])
    expect(rows[0]).toMatchObject({ installed: '16.4.2', target: '16.5.0', holes: 2, exploited: true, direct: true, severity: 'high' })
    expect(rows.find((r) => r.name === 'semver')).toMatchObject({ target: '5.7.2', direct: false, dev: true, severity: 'info' })
    expect(rows.find((r) => r.name === 'left-pad')).toMatchObject({ target: null, direct: null })
  })
})

describe('fixAllHolesPrompt', () => {
  it('lists every upgrade, flags what has no fix, and keeps the lockfile and exploit rules', () => {
    const rows = holeRowsFromGroups([
      group({ groupKey: 'a' }),
      group({ groupKey: 'b', package: 'semver', direct: false, installed: ['5.7.1'], target: '5.7.2', advisories: [{}] }),
      group({ groupKey: 'c', package: 'left-pad', target: null }),
    ])
    const text = fixAllHolesPrompt(rows)
    expect(text).toContain('known security holes in 2 dependencies')
    expect(text).toContain('- next 16.4.2 → 16.5.0 (2 known holes) [pnpm-lock.yaml]')
    expect(text).toContain('semver 5.7.1 → 5.7.2 (1 known hole, comes in through another package')
    expect(text).toContain('left-pad 16.4.2: no fixed version published yet')
    expect(text).toContain('Never edit a lockfile by hand')
    expect(text).toContain('Do not write exploit')
  })
})
