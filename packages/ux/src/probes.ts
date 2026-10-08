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
import type { AxeViolation, ProbeResult } from './types.js'

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
  }
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
  return axe + (p.overflowX ? 10 : 0) + p.smallTargets + p.consoleErrors.length * 5 + clsPenalty(p.cls)
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
