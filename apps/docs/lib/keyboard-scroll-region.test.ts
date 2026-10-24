/**
 * @vitest-environment jsdom
 *
 * Overflowing docs tables, code blocks, and lists with no controls of their
 * own must become tab stops. A region that does not overflow, or that already
 * contains a link, stays out of the tab order.
 */
import { describe, expect, it } from 'vitest'
import { syncKeyboardScrollRegions, syncScrollRegionTabStop } from './keyboard-scroll-region'

function box(tag: string, style: string, html = 'wide'): HTMLElement {
  const el = document.createElement(tag)
  el.setAttribute('style', style)
  el.innerHTML = html
  document.body.appendChild(el)
  Object.defineProperty(el, 'scrollWidth', { configurable: true, value: 400 })
  Object.defineProperty(el, 'clientWidth', { configurable: true, value: 120 })
  Object.defineProperty(el, 'scrollHeight', { configurable: true, value: 40 })
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: 40 })
  return el
}

describe('syncScrollRegionTabStop', () => {
  it('tabs to a wide table that has no links, and keeps the stop on a second pass', () => {
    const table = box('table', 'overflow-x: auto')
    syncScrollRegionTabStop(table)
    syncScrollRegionTabStop(table)
    expect(table.tabIndex).toBe(0)
    expect(table.getAttribute('data-keyboard-scroll')).toBe('1')
    table.remove()
  })

  it('leaves a table alone when a link inside can already scroll it', () => {
    const table = box('table', 'overflow-x: auto', '<a href="/docs">More</a>')
    syncScrollRegionTabStop(table)
    expect(table.hasAttribute('tabindex')).toBe(false)
    table.remove()
  })

  it('does not tab to a region that is not a scroller', () => {
    const list = box('ul', 'overflow: visible')
    syncScrollRegionTabStop(list)
    expect(list.hasAttribute('tabindex')).toBe(false)
    list.remove()
  })

  it('drops a tab stop once the region stops overflowing', () => {
    const pre = box('pre', 'overflow-x: auto; overflow-y: auto')
    syncScrollRegionTabStop(pre)
    expect(pre.tabIndex).toBe(0)
    Object.defineProperty(pre, 'scrollWidth', { configurable: true, value: 120 })
    syncScrollRegionTabStop(pre)
    expect(pre.hasAttribute('tabindex')).toBe(false)
    expect(pre.hasAttribute('data-keyboard-scroll')).toBe(false)
    pre.remove()
  })
})

describe('syncKeyboardScrollRegions', () => {
  it('marks an overflowing max-height list and a mobile table inside main', () => {
    const main = document.createElement('main')
    const list = document.createElement('ul')
    list.setAttribute('style', 'overflow-y: auto; max-height: 8rem')
    list.textContent = 'Connect steps'
    const table = document.createElement('table')
    table.setAttribute('style', 'overflow-x: auto')
    table.innerHTML = '<tr><td>Package</td><td>Latest</td></tr>'
    main.append(list, table)
    document.body.appendChild(main)
    for (const el of [list, table]) {
      Object.defineProperty(el, 'scrollWidth', { configurable: true, value: 80 })
      Object.defineProperty(el, 'clientWidth', { configurable: true, value: 80 })
      Object.defineProperty(el, 'scrollHeight', { configurable: true, value: 400 })
      Object.defineProperty(el, 'clientHeight', { configurable: true, value: 80 })
    }
    Object.defineProperty(table, 'scrollWidth', { configurable: true, value: 640 })
    Object.defineProperty(table, 'scrollHeight', { configurable: true, value: 40 })

    syncKeyboardScrollRegions(document)

    expect(list.tabIndex).toBe(0)
    expect(table.tabIndex).toBe(0)
    main.remove()
  })
})
