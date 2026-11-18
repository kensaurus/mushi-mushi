/**
 * @vitest-environment jsdom
 *
 * The sparse-map storyboard is sized to its content (two cards sat in the
 * corner of a 420px box), stacks on a phone instead of scrolling sideways,
 * wraps long labels, and shows the "thicker = more bugs" key only with links.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GraphStoryboard } from './GraphStoryboard'
import type { GraphEdge, GraphNode } from './types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
;(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
  observe() {}
  disconnect() {}
}

const nodes: GraphNode[] = [
  { id: 'g1', node_type: 'report_group', label: 'Checkout button does nothing' },
  { id: 'p1', node_type: 'page', label: '/cloudwatch/alarms/very-long-route-name' },
]
const edge: GraphEdge = { id: 'e1', source_node_id: 'g1', target_node_id: 'p1', edge_type: 'affects', weight: 1 }

let root: Root
let host: HTMLDivElement
beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

function render(edges: GraphEdge[]) {
  act(() =>
    root.render(
      createElement(GraphStoryboard, { nodes, edges, selectedNodeId: null, blastRadiusIds: new Set<string>(), onSelect: () => {}, onClear: () => {} }),
    ),
  )
}

describe('GraphStoryboard', () => {
  it('has no fixed minimum height and stacks columns below sm', () => {
    render([])
    const region = host.querySelector<HTMLElement>('[role="region"]')!
    expect(region.style.minHeight).toBe('')
    expect(host.innerHTML).not.toContain('min-h-[420px]')
    expect(region.firstElementChild!.className).toContain('flex-col')
    expect(region.firstElementChild!.className).toContain('sm:flex-row')
  })

  it('wraps the full label instead of clamping it', () => {
    render([])
    expect(host.textContent).toContain('/cloudwatch/alarms/very-long-route-name')
    expect(host.innerHTML).not.toContain('line-clamp-2')
  })

  it('shows the edge-thickness key only when links are drawn', () => {
    render([])
    expect(host.textContent).not.toContain('thicker = more bugs')
  })

  it('keeps the edge key once a link exists', () => {
    render([edge])
    expect(host.textContent).toContain('thicker = more bugs')
  })
})
