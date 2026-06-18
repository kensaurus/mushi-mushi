/**
 * FILE: apps/admin/src/lib/vizTokens.ts
 * PURPOSE: Runtime readers for @theme viz-* tokens used in SVG/canvas surfaces
 *          where Tailwind utilities cannot reach (xyflow edges, sparklines).
 */

import { useTheme } from './useTheme'

const VIZ_FALLBACKS: Record<string, string> = {
  'viz-edge-dark': 'oklch(0.22 0.01 285)',
  'viz-edge-light': 'oklch(0.91 0.01 285)',
  'viz-flow-info': 'oklch(0.68 0.15 250)',
  'viz-flow-brand': 'oklch(0.78 0.14 80)',
  'viz-flow-danger': 'oklch(0.63 0.22 25)',
  'viz-score-ok': 'oklch(0.72 0.19 155)',
  'viz-score-warn': 'oklch(0.75 0.15 80)',
  'viz-score-danger': 'oklch(0.63 0.22 25)',
  'viz-lang-default': 'oklch(0.55 0.01 285)',
  'viz-terminal-bg': 'oklch(0.12 0.01 285)',
  'viz-step-pending': 'oklch(0.65 0.02 285)',
  'viz-step-running': 'oklch(0.68 0.15 250)',
  'viz-step-passed': 'oklch(0.72 0.17 160)',
  'viz-step-failed': 'oklch(0.63 0.22 25)',
  'viz-step-skipped': 'oklch(0.55 0.01 285)',
  'viz-lang-typescript': 'oklch(0.52 0.15 250)',
  'viz-lang-javascript': 'oklch(0.86 0.16 95)',
  'viz-lang-python': 'oklch(0.48 0.12 250)',
  'viz-lang-go': 'oklch(0.62 0.12 220)',
  'viz-lang-rust': 'oklch(0.72 0.06 55)',
  'viz-lang-react': 'oklch(0.72 0.12 220)',
  'viz-neutral': 'oklch(0.55 0.02 285)',
  'viz-node-bg-dark': 'oklch(0.19 0.007 265)',
  'viz-node-bg-light': 'oklch(0.99 0.004 265)',
  'viz-node-text-dark': 'oklch(0.90 0.006 265)',
  'viz-node-text-light': 'oklch(0.16 0.006 265)',
  'viz-node-subtext': 'oklch(0.52 0.004 265)',
  'viz-node-border-dark': 'oklch(0.30 0.006 265)',
  'viz-node-border-light': 'oklch(0.82 0.004 265)',
  'viz-node-selected-dark': 'oklch(0.24 0.014 265)',
  'viz-node-selected-light': 'oklch(0.94 0.010 265)',
  'viz-graph-muted': 'oklch(0.55 0 0)',
}

const STEP_STATUS_TOKEN: Record<string, keyof typeof VIZ_FALLBACKS> = {
  pending: 'viz-step-pending',
  running: 'viz-step-running',
  passed: 'viz-step-passed',
  failed: 'viz-step-failed',
  skipped: 'viz-step-skipped',
}

/** Read a `--color-*` token from the document root; SSR-safe fallback. */
export function readVizToken(name: string, fallback?: string): string {
  const fb = fallback ?? VIZ_FALLBACKS[name] ?? 'oklch(0.55 0.01 285)'
  if (typeof document === 'undefined') return fb
  const v = getComputedStyle(document.documentElement).getPropertyValue(`--color-${name}`).trim()
  return v || fb
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
