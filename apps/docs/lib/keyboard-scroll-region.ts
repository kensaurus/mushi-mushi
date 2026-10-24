/**
 * FILE: apps/docs/lib/keyboard-scroll-region.ts
 * PURPOSE: Put overflowing docs regions in the tab order.
 *
 * Below 768px, `main table` becomes its own horizontal scroller
 * (apps/docs/app/globals.css). Markdown tables, fenced code, and a
 * max-height list have no links or buttons, so axe
 * `scrollable-region-focusable` fails until the region itself is a tab stop.
 * Only mark a region that actually overflows and has no focusable descendant.
 */

const SCROLL_CANDIDATES = 'table, pre, ul, ol, .overflow-x-auto, .overflow-y-auto, .overflow-auto, .mushi-connect-code-block'

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])'

const MARK = 'data-keyboard-scroll'

function scrolls(el: HTMLElement): boolean {
  const style = getComputedStyle(el)
  const axis = (value: string) => value === 'auto' || value === 'scroll' || value === 'overlay'
  if (!axis(style.overflowX) && !axis(style.overflowY)) return false
  return el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1
}

function hasFocusableDescendant(el: HTMLElement): boolean {
  return el.querySelector(FOCUSABLE) !== null
}

/**
 * Give one overflowing region a tab stop, or take back a stop this helper
 * added once the region no longer scrolls. A tab stop that was already on
 * the element (JSX `tabIndex={0}`) is left alone — the element itself is
 * not treated as its own focusable descendant.
 */
export function syncScrollRegionTabStop(el: HTMLElement): void {
  const marked = el.getAttribute(MARK) === '1'
  if (!scrolls(el) || hasFocusableDescendant(el)) {
    if (marked) {
      el.removeAttribute('tabindex')
      el.removeAttribute(MARK)
    }
    return
  }
  if (el.tabIndex >= 0) return
  el.tabIndex = 0
  el.setAttribute(MARK, '1')
}

/** Scan the docs article (`main`) for scroll regions that keyboard users cannot reach. */
export function syncKeyboardScrollRegions(root: ParentNode): void {
  const scope = root instanceof Document ? root.querySelector('main') ?? root : root
  scope.querySelectorAll(SCROLL_CANDIDATES).forEach((node) => {
    if (node instanceof HTMLElement) syncScrollRegionTabStop(node)
  })
}
