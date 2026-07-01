#!/usr/bin/env node
/**
 * Generates packages/brand/src/editorial.css from tokens/brand.tokens.json (DTCG).
 * Primitive values come from JSON; semantic aliases + dark block are appended.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const TOKENS = join(ROOT, 'tokens', 'brand.tokens.json')
const OUT = join(ROOT, 'src', 'editorial.css')

/** Walk DTCG token tree → flat map of css var name → value. */
function flattenDtcg(obj, path = [], out = new Map()) {
  if (obj && typeof obj === 'object' && '$value' in obj) {
    const key = cssVarName(path)
    out.set(key, formatValue(obj.$value, obj.$type))
    return out
  }
  for (const [k, v] of Object.entries(obj ?? {})) {
    if (k.startsWith('$')) continue
    flattenDtcg(v, [...path, k], out)
  }
  return out
}

function cssVarName(path) {
  const [group, ...rest] = path
  if (group === 'color') return `--mushi-${rest.join('-')}`
  if (group === 'font') return `--mushi-font-${rest[0]}`
  if (group === 'motion') return `--mushi-${rest.join('-')}`
  if (group === 'geometry') return `--mushi-${rest.join('-')}`
  return `--mushi-${path.join('-')}`
}

function formatValue(value, type) {
  if (type === 'cubicBezier' && Array.isArray(value)) {
    return `cubic-bezier(${value.join(', ')})`
  }
  if (type === 'fontFamily' && typeof value === 'string') {
    return value
      .split(',')
      .map((part) => {
        const t = part.trim()
        if (t.startsWith('"') || t.startsWith('var(')) return t
        if (t.includes(' ')) return `"${t}"`
        return t
      })
      .join(', ')
  }
  return String(value)
}

const tokens = JSON.parse(readFileSync(TOKENS, 'utf8'))
const flat = flattenDtcg(tokens)

const primitiveLines = [...flat.entries()]
  .filter(([name]) => !name.includes('dark-') || name.startsWith('--mushi-dark-'))
  .map(([name, value]) => `  ${name}: ${value};`)

const header = `/* ---------------------------------------------------------------------------
   Mushi Editorial design tokens
   AUTO-GENERATED — edit tokens/brand.tokens.json then run: pnpm build:tokens

   Light is the default everywhere. Dark mode is **opt-in** rather than
   driven by \`prefers-color-scheme\`, because:

   * The cloud marketing surface (apps/cloud) is editorial-light by design.
   * The admin app drives its own theme (\`html[data-theme="..."]\`) via JS.
   * The web SDK widget computes light/dark in JS via \`matchMedia\`.

   Earlier versions auto-swapped on \`prefers-color-scheme: dark\`, which
   silently flipped the marketing landing into a dim palette on viewers
   whose OS was set to dark. We now require an explicit
   \`data-mushi-theme="dark"\` (on \`<html>\` or any ancestor) to flip.
--------------------------------------------------------------------------- */

`

const semanticRoot = `
  /* Jade — muted editorial "pass / positive" green. */
  --mushi-font-mono: var(--font-jetbrains-mono, ui-monospace), "SF Mono", "JetBrains Mono", Menlo, Consolas, "Liberation Mono", monospace;

  /* Diagram / data-viz accents — editorial palette for docs SVG + pipeline nodes */
  --mushi-viz-accent: var(--mushi-vermillion);
  --mushi-viz-accent-wash: var(--mushi-vermillion-wash);
  --mushi-viz-accent-ink: var(--mushi-vermillion-ink);
  --mushi-viz-positive: var(--mushi-jade);
  --mushi-viz-positive-wash: var(--mushi-jade-wash);
  --mushi-viz-track: var(--mushi-rule);
  --mushi-viz-stroke: color-mix(in oklch, var(--mushi-ink) 22%, transparent);
  --mushi-viz-node-border: var(--mushi-rule);
  --mushi-viz-node-bg: var(--mushi-paper);
  --mushi-viz-selected: var(--mushi-vermillion);
  --mushi-viz-panel-bg: var(--mushi-paper-wash);
  --mushi-viz-panel-border: var(--mushi-rule);
  --mushi-viz-muted: var(--mushi-ink-muted);
  --mushi-viz-faint: var(--mushi-ink-faint);
`

const darkBlock = `
[data-mushi-theme="dark"] {
  --mushi-paper: var(--mushi-dark-paper);
  --mushi-ink: var(--mushi-dark-ink);
  --mushi-ink-muted: var(--mushi-dark-ink-muted);
  --mushi-rule: var(--mushi-dark-rule);
  --mushi-vermillion: var(--mushi-dark-vermillion);
  --mushi-vermillion-wash: var(--mushi-dark-vermillion-wash);
  --mushi-vermillion-ink: var(--mushi-dark-vermillion-ink);
  --mushi-jade: var(--mushi-dark-jade);
  --mushi-jade-wash: var(--mushi-dark-jade-wash);
  --mushi-code-surface: var(--mushi-dark-code-surface);
  --mushi-code-surface-fg: var(--mushi-dark-ink);
  --mushi-code-surface-fg-muted: var(--mushi-dark-code-surface-fg-muted);
  --mushi-code-surface-border: var(--mushi-dark-code-surface-border);
  --mushi-viz-warn: var(--mushi-dark-viz-warn);
  --mushi-viz-wash-warn: var(--mushi-dark-viz-wash-warn);
  --mushi-viz-info: var(--mushi-dark-viz-info);
  --mushi-viz-wash-info: var(--mushi-dark-viz-wash-info);
  --mushi-viz-danger: var(--mushi-dark-viz-danger);
  --mushi-viz-wash-danger: var(--mushi-dark-viz-wash-danger);
  --mushi-viz-stroke: color-mix(in oklch, var(--mushi-ink) 28%, transparent);
  --mushi-viz-node-bg: var(--mushi-paper);
  --mushi-viz-selected-fg: #ffffff;
}
`

const css = `${header}:root {${semanticRoot}\n${primitiveLines.join('\n')}\n}\n${darkBlock}\n`

writeFileSync(OUT, css, 'utf8')
console.log('[ok] Generated', OUT, `(${flat.size} primitives)`)
