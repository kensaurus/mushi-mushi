/**
 * FILE: apps/admin/src/lib/repoUnderstanding.test.ts
 * PURPOSE: Copy-digest request shape and toast summary, and the diagram's
 *          server layout reaching React Flow unchanged.
 */

import { describe, expect, it } from 'vitest'
import {
  diagramToFlow,
  digestCopiedSummary,
  digestPath,
  githubPathUrl,
  type DiagramGraph,
  type RepoDigestResponse,
} from './repoUnderstanding'

function digest(overrides: Partial<RepoDigestResponse>): RepoDigestResponse {
  return {
    owner: 'acme',
    repo: 'shop',
    sha: 'abcdef1234567890abcdef1234567890abcdef12',
    ref: 'main',
    budget_tokens: 50_000,
    total_tokens: 12_345,
    eligible_files: 40,
    files: [{ path: 'README.md', tokens: 100, truncated: false }],
    dropped_counts: {},
    redacted: [],
    tree_truncated: false,
    scope: { kind: 'repo', label: 'whole repo' },
    cached: false,
    text: '',
    ...overrides,
  }
}

describe('digestPath', () => {
  it('carries the budget and, for a bug, the report id', () => {
    expect(digestPath('p1', { budgetTokens: 25_000 })).toBe('/v1/admin/projects/p1/codebase/digest?budget=25000')
    expect(digestPath('p1', { budgetTokens: 50_000, reportId: 'r1' })).toBe(
      '/v1/admin/projects/p1/codebase/digest?budget=50000&report_id=r1',
    )
  })
})

describe('digestCopiedSummary', () => {
  it('reports files, tokens and the commit', () => {
    expect(digestCopiedSummary(digest({}))).toBe('1 of 40 files · about 12,345 tokens · commit abcdef1')
  })
  it('says when secret-looking files were left out', () => {
    expect(digestCopiedSummary(digest({ redacted: [{ path: '.x', label: 'JWT' }] }))).toContain(
      '1 file left out because it looks like a secret',
    )
  })
  it('says plainly when a bug has no linked files', () => {
    const none = digest({
      scope: { kind: 'report', label: '', sources: { stack_frames: 0, fix_files: 0, related_code: 0, dependents: 0 } },
    })
    expect(digestCopiedSummary(none)).toMatch(/^No files are linked to this bug yet/)
    const some = digest({
      scope: { kind: 'report', label: '', sources: { stack_frames: 2, fix_files: 1, related_code: 0, dependents: 3 } },
    })
    expect(digestCopiedSummary(some)).toMatch(/^6 files linked to this bug go first\./)
  })
})

describe('diagramToFlow', () => {
  const graph: DiagramGraph = {
    groups: [{ id: 'web', label: 'Web', x: 0, y: 0, w: 252, h: 200 }],
    nodes: [
      { id: 'ui', label: 'UI', group: 'web', path: 'apps/web', description: 'd', x: 16, y: 52 },
      { id: 'api', label: 'API', group: 'web', path: null, path_invalid: true, description: '', x: 16, y: 136 },
    ],
    edges: [{ from: 'ui', to: 'api', label: 'calls' }],
  }

  it('uses the server positions and draws groups behind components', () => {
    const { nodes, edges } = diagramToFlow(graph, null)
    expect(nodes.map((n) => [n.id, n.position.x, n.position.y, n.zIndex])).toEqual([
      ['group:web', 0, 0, 0],
      ['ui', 16, 52, 1],
      ['api', 16, 136, 1],
    ])
    expect(nodes[2].data.pathInvalid).toBe(true)
    expect(edges).toEqual([{ id: 'ui->api', source: 'ui', target: 'api', label: 'calls', animated: false }])
  })

  it('highlights the selected component and its edges', () => {
    const { nodes, edges } = diagramToFlow(graph, 'ui')
    expect(nodes.find((n) => n.id === 'ui')?.data.selected).toBe(true)
    expect(edges[0].animated).toBe(true)
  })
})

describe('githubPathUrl', () => {
  it('pins the link to the diagram commit and encodes each segment', () => {
    expect(githubPathUrl('acme', 'shop', 'c'.repeat(40), 'apps/my app')).toBe(
      `https://github.com/acme/shop/tree/${'c'.repeat(40)}/apps/my%20app`,
    )
  })
})
