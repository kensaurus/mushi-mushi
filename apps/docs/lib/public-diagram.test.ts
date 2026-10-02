/**
 * Public diagram page helpers: which repo a URL names (path or query, junk
 * rejected), edge geometry, and links that keep sign-ups attributable.
 */

import { describe, expect, it } from 'vitest'
import {
  canvasSize,
  diagramSignupHref,
  edgePath,
  NODE_H,
  NODE_W,
  parseRepoFromLocation,
  reportDiagramHref,
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
  it('opens a prefilled issue naming the repo and commit', () => {
    const href = reportDiagramHref('acme', 'shop', 'abcdef1234')
    expect(href).toMatch(/^https:\/\/github\.com\/kensaurus\/mushi-mushi\/issues\/new\?title=/)
    expect(decodeURIComponent(href)).toContain('commit abcdef1')
  })
})
