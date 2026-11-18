import { describe, expect, it } from 'vitest'
import { codeCheckGroups, discoverySnippet, gateStatusLine } from './inventoryView'

describe('inventoryView (2026-11-18)', () => {
  it('puts the worst check first and the worst finding first inside it', () => {
    const groups = codeCheckGroups([
      { id: 'a', gate: 'radar', severity: 'warn' },
      { id: 'b', gate: 'radar', severity: 'error' },
      { id: 'c', gate: 'vulns', severity: 'info' },
      { id: 'd', gate: 'vulns', severity: 'warn' },
    ])
    expect(groups.map((g) => g.gate)).toEqual(['radar', 'vulns'])
    expect(groups[0].findings.map((f) => f.id)).toEqual(['b', 'a'])
    expect(groups[1].findings.map((f) => f.id)).toEqual(['d', 'c'])
  })

  it('names the checks that never ran once, and the ones that ran with their result', () => {
    const line = gateStatusLine(
      ['dead_handler', 'mock_leak', 'crawl'],
      (g) => (g === 'crawl' ? { word: 'Passed', open: 0 } : g === 'mock_leak' ? { word: 'Found problems', open: 2 } : null),
      (g) => ({ dead_handler: 'Dead handlers', mock_leak: 'Mock data', crawl: 'Live route crawl' })[g]!,
    )
    expect(line.notRun).toEqual(['Dead handlers'])
    expect(line.ran.map((r) => r.text)).toEqual(['Mock data: Found problems, 2 open', 'Live route crawl: Passed'])
  })

  it('uses the current package, the same as Manage apps', () => {
    const s = discoverySnippet('p1')
    expect(s).toContain("from 'mushi-mushi'")
    expect(s).not.toContain('@mushi-mushi/web')
    expect(s).toContain('discoverInventory')
    expect(s).toContain("projectId: 'p1'")
  })
})
