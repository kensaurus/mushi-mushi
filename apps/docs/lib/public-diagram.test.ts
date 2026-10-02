/**
 * Public diagram page helpers: which repo a URL names (path or query, junk
 * rejected), edge geometry, and links that keep sign-ups attributable.
 */

import { describe, expect, it, vi } from 'vitest'
import {
  canvasSize,
  diagramSignupHref,
  edgePath,
  NODE_H,
  NODE_W,
  parseRepoFromLocation,
  diagramReportMailto,
  reportWrongDiagram,
  type PublicDiagramNode,
} from './public-diagram'

describe('parseRepoFromLocation', () => {
  it('reads /r/<owner>/<repo> from the rewritten path', () => {
    expect(parseRepoFromLocation('/mushi-mushi/r/kensaurus/mushi-mushi', '')).toEqual({ owner: 'kensaurus', repo: 'mushi-mushi' })
    expect(parseRepoFromLocation('/mushi-mushi/r/acme/shop.js/', '')).toEqual({ owner: 'acme', repo: 'shop.js' })
  })
  it('falls back to ?repo= on the docs shell URL', () => {
    expect(parseRepoFromLocation('/mushi-mushi/docs/r', '?repo=acme/shop')).toEqual({ owner: 'acme', repo: 'shop' })
  })
  it('rejects junk and traversal', () => {
    expect(parseRepoFromLocation('/mushi-mushi/docs/r', '')).toBeNull()
    expect(parseRepoFromLocation('/mushi-mushi/docs/r', '?repo=acme')).toBeNull()
    expect(parseRepoFromLocation('/mushi-mushi/r/acme/..', '')).toBeNull()
    expect(parseRepoFromLocation('/mushi-mushi/r/-bad/x', '')).toBeNull()
    expect(parseRepoFromLocation('/mushi-mushi/r/a%2Fb/x', '')).toBeNull()
  })
})

describe('edgePath', () => {
  const node = (x: number, y: number): PublicDiagramNode => ({ id: `${x}`, label: '', group: '', path: null, description: '', x, y })
  it('runs from the right of the caller to the left of the callee', () => {
    expect(edgePath(node(0, 0), node(400, 100))).toBe(`M ${NODE_W} ${NODE_H / 2} C 310 32, 310 132, 400 132`)
  })
  it('loops out to the right within one column', () => {
    expect(edgePath(node(0, 0), node(0, 100))).toMatch(/^M 220 32 C 268 32, 268 132, 220 132$/)
  })
})

describe('canvasSize', () => {
  it('covers every group and node with a margin', () => {
    expect(canvasSize({ groups: [{ id: 'g', label: '', x: 0, y: 0, w: 252, h: 300 }], nodes: [] })).toEqual({ width: 284, height: 332 })
  })
})

describe('links', () => {
  it('tags the sign-up with the page and repo', () => {
    expect(diagramSignupHref('acme', 'shop')).toBe('https://kensaur.us/mushi-mushi/admin/signup?src=diagram%3Aacme%2Fshop')
  })
})

describe('reportWrongDiagram', () => {
  const target = { owner: 'acme', repo: 'shop', sha: 'a'.repeat(40), nodePath: 'apps/web', nodeLabel: 'Web UI' }

  it("files it in Mushi's own queue when the SDK is loaded, with repo, commit and part", () => {
    const setMetadata = vi.fn()
    const report = vi.fn()
    expect(reportWrongDiagram(target, { setMetadata, report })).toEqual({ via: 'sdk' })
    expect(setMetadata).toHaveBeenCalledWith('public_diagram', {
      repo: 'acme/shop',
      sha: 'a'.repeat(40),
      node_path: 'apps/web',
      node_label: 'Web UI',
      page: 'https://kensaur.us/mushi-mushi/r/acme/shop',
    })
    expect(report).toHaveBeenCalledWith({ category: 'other' })
  })

  it('falls back to a private email, never a public issue', () => {
    const out = reportWrongDiagram(target, null)
    expect(out.via).toBe('email')
    const href = out.via === 'email' ? out.href : ''
    expect(href).toMatch(/^mailto:kensaurus@gmail\.com\?subject=/)
    expect(href).not.toContain('github.com')
    const decoded = decodeURIComponent(href)
    expect(decoded).toContain('Wrong or unwanted diagram: acme/shop')
    expect(decoded).toContain(`Commit: ${'a'.repeat(40)}`)
    expect(decoded).toContain('Part: Web UI (apps/web)')
  })

  it('leaves the part line out when no part is selected', () => {
    expect(decodeURIComponent(diagramReportMailto({ owner: 'a', repo: 'b', sha: 'c'.repeat(40) }))).not.toContain('Part:')
  })
})
