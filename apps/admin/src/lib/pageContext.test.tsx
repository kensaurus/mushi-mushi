/**
 * @vitest-environment jsdom
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { usePageContext, usePublishPageContext } from './pageContext'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let host: HTMLDivElement | null = null

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
})

function mount(node: ReturnType<typeof createElement>) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root!.render(node))
  return host
}

describe('usePublishPageContext', () => {
  it('lets one component publish a fresh object every render and read it back', () => {
    // TesterLayout does exactly this: it publishes `{ route, title }` as a new
    // literal each render and reads the store through useDocumentTitle. The
    // registry used to swap its snapshot for that new object after every
    // commit, so React re-rendered the reader forever (error 185).
    let renders = 0
    function PublishAndRead() {
      renders += 1
      usePublishPageContext({ route: '/tester', title: 'Tester · Home' })
      const ctx = usePageContext()
      return createElement('p', null, ctx?.title ?? 'none')
    }
    const el = mount(createElement(PublishAndRead))
    expect(el.textContent).toBe('Tester · Home')
    expect(renders).toBeLessThan(5)
  })

  it('still forwards the newest action closures without a re-render', () => {
    const first = vi.fn()
    const second = vi.fn()
    let readCtx: ReturnType<typeof usePageContext> = null
    function Reader() {
      readCtx = usePageContext()
      return null
    }
    function Publisher({ run }: { run: () => void }) {
      usePublishPageContext({ route: '/r', title: 'R', actions: [{ id: 'a', label: 'A', run }] })
      return null
    }
    mount(createElement('div', null, createElement(Publisher, { run: first }), createElement(Reader)))
    act(() => root!.render(createElement('div', null, createElement(Publisher, { run: second }), createElement(Reader))))
    readCtx!.actions![0].run()
    expect(second).toHaveBeenCalledTimes(1)
    expect(first).not.toHaveBeenCalled()
  })
})
