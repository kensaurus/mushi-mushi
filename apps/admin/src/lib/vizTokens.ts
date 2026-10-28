/**
 * FILE: apps/admin/src/lib/vizTokens.ts
 * PURPOSE: Runtime readers for @theme viz-* tokens used in SVG/canvas surfaces
 *          where Tailwind utilities cannot reach (xyflow edges, sparklines).
 *
 *          The palette lives only in styles/theme-tokens.css (@theme static).
 *          This module does not copy those colours. When the variable is not
 *          applied yet (tests, the tick before CSS), one generic stand-in is
 *          used so a paint still has a colour.
 */

import { useTheme } from './useTheme'

/** Stand-in when the stylesheet has not applied the variable. Not a palette. */
export const VIZ_TOKEN_MISSING = 'oklch(0.55 0.01 285)'

const warnedMissing = new Set<string>()

const STEP_STATUS_TOKEN: Record<string, string> = {
  pending: 'viz-step-pending',
  running: 'viz-step-running',
  passed: 'viz-step-passed',
  failed: 'viz-step-failed',
  skipped: 'viz-step-skipped',
}

function missingVizToken(name: string): string {
  const dev =
    import.meta.env?.DEV === true &&
    import.meta.env.MODE !== 'test'
  if (dev && !warnedMissing.has(name)) {
    warnedMissing.add(name)
    console.warn(
      `[viz] --color-${name} is missing from the stylesheet. Chart colours come from the @theme static block in styles/theme-tokens.css.`,
    )
  }
  return VIZ_TOKEN_MISSING
}

/** Read a `--color-*` token from the document root. */
export function readVizToken(name: string, fallback?: string): string {
  if (typeof document === 'undefined') return fallback ?? VIZ_TOKEN_MISSING
  const v = getComputedStyle(document.documentElement).getPropertyValue(`--color-${name}`).trim()
  if (v) return v
  return fallback ?? missingVizToken(name)
}

/**
 * Colour map that reads each token when the property is used.
 * Properties are getter-only, so the type is readonly: assignment is a type error
 * and throws at runtime.
 * main.tsx imports the app graph before index.css, so a module-scope
 * readVizToken() runs before the stylesheet exists and would freeze the
 * stand-in for the rest of the page.
 */
export function vizColorMap<K extends string>(tokens: Record<K, string>): Readonly<Record<K, string>> {
  const out = {} as Record<K, string>
  for (const key of Object.keys(tokens) as K[]) {
    const name = tokens[key]
    Object.defineProperty(out, key, {
      enumerable: true,
      get: () => readVizToken(name),
    })
  }
  return out
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
