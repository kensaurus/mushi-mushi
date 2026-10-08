// SPDX-License-Identifier: MIT
/**
 * Shared shapes for the UX loop: a surface is one screen state worth
 * reviewing (a page, a tab on it, a dialog it opens), reached by loading a
 * URL path and replaying a few clicks.
 */

export type SurfaceKind = 'page' | 'tab' | 'dialog' | 'menu'

/** One replayable click. `selector` is a Playwright selector string. */
export interface ReplayStep {
  action: 'click'
  selector: string
  label: string
}

export interface Surface {
  /** Stable id: path + replay labels, slugged. */
  key: string
  kind: SurfaceKind
  /** Same-origin path with query. Never a full URL, never a token. */
  path: string
  steps: ReplayStep[]
  label: string
  /** Structural hash of the rendered DOM, for dedupe across param routes. */
  domHash: string
}

export interface Viewport {
  name: 'desktop' | 'mobile'
  width: number
  height: number
}

export const VIEWPORTS: readonly Viewport[] = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
]

export interface AxeViolation {
  id: string
  impact: string | null
  help: string
  /** How many nodes fail the rule. */
  count: number
  /** CSS selectors of the offending nodes (first few). */
  targets: string[]
}

/** Objective, repeatable measurements of one surface at one viewport. */
export interface ProbeResult {
  axe: AxeViolation[]
  /** Page scrolls sideways at this width. */
  overflowX: boolean
  /** Interactive elements smaller than 24×24 CSS px (WCAG 2.2 target size). */
  smallTargets: number
  consoleErrors: string[]
  /** Cumulative layout shift observed while the surface settled. */
  cls: number
}
