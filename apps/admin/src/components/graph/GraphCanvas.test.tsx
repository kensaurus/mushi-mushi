/**
 * FILE: GraphCanvas.test.tsx
 * PURPOSE: The pan/zoom hint must sit above the graph and break only on
 *          the "·" separators. A React Flow top-center panel is left:50%
 *          with shrink-to-fit, so at 390px the sentence wraps mid-phrase
 *          and the tall chip covers the nodes (report 8171741f).
 */

import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@xyflow/react', () => ({
  ReactFlow: ({ children }: { children?: ReactNode }) =>
    createElement('div', { className: 'react-flow' }, children),
  Background: () => null,
  Panel: ({ children, position }: { children?: ReactNode; position?: string }) =>
    createElement('div', { className: `react-flow__panel ${position ?? ''}` }, children),
  useReactFlow: () => ({ zoomIn: () => {}, zoomOut: () => {}, fitView: () => {} }),
  Handle: () => null,
  Position: { Left: 'left', Right: 'right', Top: 'top', Bottom: 'bottom' },
}))

import { GraphCanvas } from './GraphCanvas'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let host: HTMLDivElement

beforeEach(() => {
  window.localStorage.clear()
  window.matchMedia = ((q: string) => ({
    matches: false,
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

function render() {
  act(() => {
    root.render(createElement(GraphCanvas, {
      flowNodes: [],
      flowEdges: [],
      filteredCount: 1,
      filteredEdgeCount: 0,
      onNodeClick: () => {},
      onPaneClick: () => {},
      onResetView: () => {},
    }))
  })
}

describe('GraphCanvas pan/zoom hint', () => {
  it('sits above the graph and wraps only between phrases', () => {
    render()
    const hint = host.querySelector('[data-testid="graph-pan-zoom-hint"]')
    const flow = host.querySelector('.react-flow')
    expect(host.querySelector('[role="region"]')).not.toBeNull()
    expect(hint).not.toBeNull()
    expect(flow).not.toBeNull()
    expect(hint!.closest('.react-flow')).toBeNull()
    expect(hint!.closest('.react-flow__panel')).toBeNull()
    expect(hint!.compareDocumentPosition(flow!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    const phrases = [...hint!.querySelectorAll('[data-hint-phrase]')]
    expect(phrases.map((el) => el.textContent)).toEqual([
      'Drag to pan',
      'scroll to zoom',
      'click a node for blast radius',
    ])
    for (const el of phrases) {
      expect(el.className).toContain('whitespace-nowrap')
    }
  })
})
