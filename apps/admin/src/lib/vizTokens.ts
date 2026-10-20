/**
 * FILE: apps/admin/src/lib/vizTokens.ts
 * PURPOSE: Runtime readers for @theme static viz-* tokens used in SVG/canvas
 *          surfaces where Tailwind utilities cannot reach (xyflow edges,
 *          sparklines). Colour values live only in styles/theme-tokens.css.
 */

import { useTheme } from './useTheme'

/**
 * Stand-in when the stylesheet is not applied (unit tests, no document).
 * The chart palette is the CSS custom properties.
 */
const UNSTYLED = 'oklch(0.55 0.01 285)'

const STEP_STATUS_TOKEN: Record<string, string> = {
  pending: 'viz-step-pending',
  running: 'viz-step-running',
  passed: 'viz-step-passed',
  failed: 'viz-step-failed',
  skipped: 'viz-step-skipped',
}

/** Read a `--color-*` token from the document root. */
export function readVizToken(name: string, fallback?: string): string {
  const unset = fallback ?? UNSTYLED
  if (typeof document === 'undefined') return unset
  const v = getComputedStyle(document.documentElement).getPropertyValue(`--color-${name}`).trim()
  return v || unset
}

export function stepStatusColor(status: string): string {
  const key = STEP_STATUS_TOKEN[status] ?? 'viz-step-pending'
  return readVizToken(key)
}

export function langVizColor(lang: string): string {
  const map: Record<string, string> = {
    typescript: 'viz-lang-typescript',
    javascript: 'viz-lang-javascript',
    python: 'viz-lang-python',
    go: 'viz-lang-go',
    rust: 'viz-lang-rust',
    tsx: 'viz-lang-react',
    jsx: 'viz-lang-react',
    ts: 'viz-lang-typescript',
    js: 'viz-lang-javascript',
    py: 'viz-lang-python',
    rb: 'viz-flow-danger',
    rs: 'viz-lang-rust',
    sql: 'viz-step-running',
    md: 'viz-neutral',
    json: 'viz-flow-brand',
    yaml: 'viz-flow-brand',
    yml: 'viz-flow-brand',
  }
  return readVizToken(map[lang] ?? 'viz-lang-default')
}

/** File-extension badge colour for explore / graph canvases. */
export function extBadgeColor(ext: string): string {
  return langVizColor(ext)
}

export function exploreNodeChrome(
  theme: 'dark' | 'light',
  _selected: boolean,
): {
  nodeBg: string
  textColor: string
  subTextColor: string
  borderColor: string
  selectedBg: string
} {
  const dark = theme === 'dark'
  return {
    nodeBg: readVizToken(dark ? 'viz-node-bg-dark' : 'viz-node-bg-light'),
    textColor: readVizToken(dark ? 'viz-node-text-dark' : 'viz-node-text-light'),
    subTextColor: readVizToken('viz-node-subtext'),
    borderColor: readVizToken(dark ? 'viz-node-border-dark' : 'viz-node-border-light'),
    selectedBg: readVizToken(dark ? 'viz-node-selected-dark' : 'viz-node-selected-light'),
  }
}

export function graphMutedColor(): string {
  return readVizToken('viz-graph-muted')
}

export function useVizColors() {
  const { resolved } = useTheme()
  return {
    arrowHalo: readVizToken(resolved === 'dark' ? 'viz-edge-dark' : 'viz-edge-light'),
    flowInfo: readVizToken('viz-flow-info'),
    flowBrand: readVizToken('viz-flow-brand'),
    flowDanger: readVizToken('viz-flow-danger'),
  }
}
