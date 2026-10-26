/**
 * @vitest-environment jsdom
 *
 * Cursor agent artifacts keep the h4 they had before the fixes detail panel
 * moved its sections to h3. That panel passes h3 so the heading matches them.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CursorArtifactsGallery } from './CursorArtifactsGallery'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const artifact = { kind: 'log' as const, path: 'run/log.txt', mime: 'text/plain' }

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

function render(heading?: 'h3' | 'h4') {
  act(() => {
    root.render(createElement(CursorArtifactsGallery, { artifacts: [artifact], ...(heading ? { heading } : {}) }))
  })
}

describe('CursorArtifactsGallery', () => {
  it('stays an h4 unless the caller asks for an h3', () => {
    render()
    expect(host.querySelector('h4')?.textContent).toBe('Cursor agent artifacts')
    expect(host.querySelector('h3')).toBeNull()

    render('h3')
    expect(host.querySelector('h3')?.textContent).toBe('Cursor agent artifacts')
    expect(host.querySelector('h4')).toBeNull()
  })
})
