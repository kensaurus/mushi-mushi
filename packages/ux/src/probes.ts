// SPDX-License-Identifier: MIT
/**
 * Objective checks run on every capture. A vision model's opinion of a
 * screenshot is unreliable (Baymard: 80% of GPT-4 audit suggestions were
 * wrong or wasted effort; UICrit: 13% of zero-shot critiques valid), so the
 * loop's accept/reject leans on these numbers, not on taste.
 *
 * Contrast comes from axe-core's `color-contrast` rule, which parses modern
 * colour syntax (oklch, color-mix) itself.
 */

import { AxeBuilder } from '@axe-core/playwright'
import type { Page } from 'playwright'
import type { AxeViolation, LayoutIssue, ProbeResult } from './types.js'

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']
const MAX_TARGETS = 5

/** The selectors this page's browser can parse; a bad one is dropped, not fatal. */
async function usableSelectors(page: Page, selectors: readonly string[]): Promise<string[]> {
  if (!selectors.length) return []
  return page.evaluate((list) => {
    return list.filter((sel) => {
      try {
        document.querySelector(sel)
        return true
      } catch {
        return false
      }
    })
  }, [...selectors])
}

export async function runProbes(
  page: Page,
  consoleErrors: readonly string[],
  ignore: readonly string[] = [],
): Promise<ProbeResult> {
  const skip = await usableSelectors(page, ignore)
  let builder = new AxeBuilder({ page }).withTags(AXE_TAGS)
  for (const sel of skip) builder = builder.exclude(sel)
  const axe = await builder
    .analyze()
    .then((r) =>
      r.violations.map(
        (v): AxeViolation => ({
          id: v.id,
          impact: v.impact ?? null,
          help: v.help,
          count: v.nodes.length,
          targets: v.nodes.slice(0, MAX_TARGETS).map((n) => n.target.join(' ')),
        }),
      ),
    )
  // No catch: an axe failure must fail the capture. Reading it as "no
  // violations" would make a broken after-shot look like an improvement.

  const layout = await page.evaluate((skipSelectors) => {
    const root = document.documentElement
    const overflowX = root.scrollWidth > root.clientWidth + 1
    const interactive = document.querySelectorAll(
      'a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=link], [role=tab], [role=checkbox], [role=switch], [role=menuitem]',
    )
    let smallTargets = 0
    for (const el of Array.from(interactive)) {
      const style = getComputedStyle(el)
      if (style.visibility === 'hidden' || style.display === 'none') continue
      // Not the app's UI (dev overlays, build stamps, the Mushi widget).
      if (skipSelectors.some((sel) => el.closest(sel))) continue
      // Nothing to tap: the element ignores the pointer.
      if (style.pointerEvents === 'none') continue
      // WCAG 2.5.8 exempts links inside running text.
      if (el.tagName === 'A' && style.display === 'inline') continue
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue
      // Visually hidden until focused (an sr-only skip link is 1x1 and clipped).
      const clipped = style.clip.startsWith('rect(0') || style.clipPath.startsWith('inset(50%')
      if (clipped || (r.width <= 1 && r.height <= 1)) continue
      if (r.width < 24 || r.height < 24) smallTargets++
    }
    const cls = (window as unknown as { __mushiCls?: number }).__mushiCls ?? 0
    return { overflowX, smallTargets, cls }
  }, skip)

  return {
    axe,
    overflowX: layout.overflowX,
    smallTargets: layout.smallTargets,
    consoleErrors: [...consoleErrors],
    cls: Math.round(layout.cls * 1000) / 1000,
    layout: await layoutIssues(page, skip),
  }
}

const MAX_LAYOUT_ISSUES = 8
/** A collision or overhang smaller than this is antialiasing or a border, not a bug. */
const LAYOUT_SLOP_PX = 4

/**
 * Boxes a person sees collide or stick out, measured, not judged: in-flow
 * siblings drawn over each other, and controls that outgrow their container,
 * wrap past two lines or cut their own label off. The Mushi console's Apps
 * page had oversized, overflowing buttons and overlapping cards that no other
 * probe saw (2026-10-26). Deliberate overlap is skipped: positioned layers,
 * negative margins (avatar stacks), transforms, grid items placed in one cell,
 * scroll containers.
 */
async function layoutIssues(page: Page, skipSelectors: readonly string[]): Promise<LayoutIssue[]> {
  return page.evaluate(
    ({ skipSelectors, max, slop }) => {
      type Issue = { kind: 'overlap' | 'outgrows'; selector: string; detail: string }
      const out: Issue[] = []
      const seen = new Set<string>()
      const add = (kind: Issue['kind'], el: Element, detail: string) => {
        const selector = nameOf(el)
        if (seen.has(kind + selector) || out.filter((i) => i.kind === kind).length >= max) return
        seen.add(kind + selector)
        out.push({ kind, selector, detail })
      }
      function nameOf(el: Element): string {
        const id = el.id ? `#${el.id}` : ''
        const cls =
          typeof el.className === 'string'
            ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((c) => `.${c}`).join('')
            : ''
        const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40)
        return `${el.tagName.toLowerCase()}${id}${cls}${text ? ` "${text}"` : ''}`
      }
      const px = (v: string) => parseFloat(v) || 0
      const skipped = (el: Element) => skipSelectors.some((sel) => el.closest(sel))
      const visible = (s: CSSStyleDeclaration, r: DOMRect) =>
        s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) > 0.05 && r.width > 0 && r.height > 0
      const placed = (s: CSSStyleDeclaration) =>
        (s.position === 'relative' && ((s.top !== 'auto' && px(s.top) !== 0) || (s.left !== 'auto' && px(s.left) !== 0))) ||
        s.transform !== 'none' ||
        px(s.marginLeft) < 0 ||
        px(s.marginTop) < 0 ||
        px(s.marginRight) < 0 ||
        px(s.marginBottom) < 0

      // Overlap: siblings in normal flow whose boxes intersect.
      for (const parent of Array.from(document.querySelectorAll('body *'))) {
        if (parent.childElementCount < 2 || skipped(parent)) continue
        const ps = getComputedStyle(parent)
        const kids = Array.from(parent.children)
          .slice(0, 40)
          .map((el) => ({ el, s: getComputedStyle(el), r: el.getBoundingClientRect() }))
          .filter(
            ({ el, s, r }) =>
              visible(s, r) &&
              (s.position === 'static' || s.position === 'relative') &&
              s.display !== 'inline' &&
              s.display !== 'contents' &&
              s.float === 'none' &&
              !placed(s) &&
              !skipped(el),
          )
        for (let i = 0; i < kids.length; i++) {
          for (let j = i + 1; j < kids.length; j++) {
            const a = kids[i]
            const b = kids[j]
            // Grid items put in one cell on purpose (a stack of layers).
            if (ps.display.includes('grid') && a.s.gridArea === b.s.gridArea && !a.s.gridArea.startsWith('auto')) continue
            const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left)
            const h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top)
            if (w > slop && h > slop) {
              add('overlap', b.el, `overlaps ${nameOf(a.el)} by ${Math.round(w)}×${Math.round(h)}px`)
            }
          }
        }
      }

      // Outgrows: controls too big for where they sit.
      const controls = document.querySelectorAll('button, [role=button], a[href], input[type=submit], input[type=button], select')
      for (const el of Array.from(controls)) {
        if (skipped(el)) continue
        const s = getComputedStyle(el)
        const r = el.getBoundingClientRect()
        if (!visible(s, r) || s.position === 'fixed' || s.position === 'absolute' || placed(s)) continue
        if (el.tagName === 'A' && s.display === 'inline') continue
        let box: Element | null = el.parentElement
        while (box && getComputedStyle(box).display === 'contents') box = box.parentElement
        if (box) {
          const bs = getComputedStyle(box)
          const br = box.getBoundingClientRect()
          const scrolls = /auto|scroll/.test(bs.overflowX)
          if (!scrolls && br.width > 0) {
            const right = r.right - br.right
            const left = br.left - r.left
            if (right > slop || left > slop) {
              add('outgrows', el, `sticks ${Math.round(Math.max(right, left))}px out of its container (${Math.round(r.width)}px wide in ${Math.round(br.width)}px)`)
              continue
            }
          }
        }
        // Label-only buttons: everything inside flows inline (text, icons).
        const labelOnly = Array.from(el.querySelectorAll('*')).every(
          (c) => getComputedStyle(c).display.startsWith('inline') || c.closest('svg') !== null,
        )
        const text = (el.textContent ?? '').trim()
        if (!labelOnly || !text || el.tagName === 'A') continue
        if (s.overflow !== 'visible' && el.scrollWidth > el.clientWidth + 1 && s.textOverflow !== 'ellipsis') {
          add('outgrows', el, `label is cut off (needs ${el.scrollWidth}px, has ${el.clientWidth}px)`)
          continue
        }
        const line = px(s.lineHeight) || px(s.fontSize) * 1.2
        const inner = r.height - px(s.paddingTop) - px(s.paddingBottom) - px(s.borderTopWidth) - px(s.borderBottomWidth)
        const lines = line > 0 ? Math.round(inner / line) : 1
        if (lines > 2) add('outgrows', el, `label wraps to ${lines} lines (${Math.round(r.width)}×${Math.round(r.height)}px)`)
      }
      return out
    },
    { skipSelectors: [...skipSelectors], max: MAX_LAYOUT_ISSUES, slop: LAYOUT_SLOP_PX },
  )
}

/**
 * Console messages the framework's own dev tooling prints, which the app's
 * code cannot fix. On glot.it, React's key warning from Next 16's segment
 * explorer ("Check the render method of `OuterLayoutRouter`") sent the agent
 * into node_modules/next for a whole 15-minute attempt (2026-10-06).
 */
const FRAMEWORK_NOISE: readonly RegExp[] = [
  /Check the render method of `(OuterLayoutRouter|InnerLayoutRouter|LayoutRouter|SegmentViewNode|SegmentStateProvider|RenderFromTemplateContext|ScrollAndFocusHandler|HTTPAccessFallbackBoundary|RedirectBoundary|ErrorBoundaryHandler|AppRouter|HotReload|ReactDevOverlay)`/,
  /\[(Fast Refresh|HMR)\]/,
  /Download the React DevTools/,
  /_next\/webpack-hmr|__nextjs_original-stack-frame/,
]

export function isFrameworkNoise(message: string): boolean {
  return FRAMEWORK_NOISE.some((re) => re.test(message))
}

const IMPACT_WEIGHT: Record<string, number> = { critical: 8, serious: 4, moderate: 2, minor: 1 }

/**
 * One number per capture, lower is better. Used only to compare the same
 * surface before and after an agent run, never across surfaces.
 */
export function probePenalty(p: ProbeResult): number {
  const axe = p.axe.reduce((sum, v) => sum + (IMPACT_WEIGHT[v.impact ?? ''] ?? 1) * Math.max(1, v.count), 0)
  return axe + (p.overflowX ? 10 : 0) + p.smallTargets + p.consoleErrors.length * 5 + clsPenalty(p.cls) + (p.layout?.length ?? 0) * 3
}

/**
 * Layout shift up to 0.1 is "good" (web.dev/articles/cls), and a dev server
 * that just recompiled shifts a little on its own: glot.it's Home lost two
 * attempts to 0.085 and 0.05 (2026-10-06). Only shift past the threshold
 * counts.
 */
export const CLS_GOOD = 0.1

function clsPenalty(cls: number): number {
  return cls > CLS_GOOD ? Math.ceil((cls - CLS_GOOD) * 20) : 0
}
