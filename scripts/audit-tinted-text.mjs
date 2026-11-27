#!/usr/bin/env node
/**
 * CI gate: no bare tinted text in the admin console.
 *
 * "Bare tinted text" is copy on a flat tinted wash with no edge: a semantic
 * muted / subtle / opacity background (`bg-ok-muted`, `bg-warn/15`,
 * `bg-st-passed-soft`) or a neutral chip fill (`bg-surface-overlay`) plus a
 * text colour, and no border, ring or outline at rest. It reads as a
 * highlighter stroke, not a component (owner, 2026-11-27). A chip, tag or
 * banner takes its shape from a design-system recipe instead: `CHIP_TONE.*`
 * (`inset-ring` edge), `Badge`, `SeverityPill`, `StatusPill`, `Callout`, `Kbd`.
 *
 * Counted per class string (quoted, or a template literal with its `${}`
 * holes blanked). Non-text fills (dots, stripes, bars, heat cells, skeletons)
 * carry no text colour and are not counted.
 *
 * Usage:
 *   node scripts/audit-tinted-text.mjs            # report
 *   node scripts/audit-tinted-text.mjs --strict   # exit 1 on any finding
 *   node scripts/audit-tinted-text.mjs --json     # machine-readable inventory
 *
 * Allowlist: `mushi-mushi-allowlist: <reason>` on the line, or the line above.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ADMIN_SRC = resolve(__dirname, '../apps/admin/src')
const strict = process.argv.includes('--strict')
const asJson = process.argv.includes('--json')

const SEM = 'ok|warn|danger|info|accent|brand|lime|rose|sev-medium'
// An opacity tint is below 70 %; `bg-brand/90` is a solid fill (a button), not a wash.
const TINT_SEM_RE = new RegExp(String.raw`(?:^|\s)bg-(?:${SEM})-(?:muted|subtle)(?:\/[\d.]+)?(?=\s|$)|(?:^|\s)bg-(?:${SEM})\/(?:[1-6]?\d(?:\.\d+)?)(?=\s|$)`)
const TINT_ST_RE = /(?:^|\s)bg-st-[a-z]+-soft(?:\/[\d.]+)?(?=\s|$)/
const TINT_NEUTRAL_RE = /(?:^|\s)bg-surface-overlay(?:\/[\d.]+)?(?=\s|$)/
const TEXT_SIZE_WORDS = new Set([
  'xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '2xs', '3xs',
  'left', 'right', 'center', 'justify', 'start', 'end', 'wrap', 'nowrap',
  'balance', 'pretty', 'ellipsis', 'clip',
])
/** An edge at rest is a width: border, ring, inset-ring or outline. A border
 *  colour alone (`border-info/30`) is not one; a tone fragment whose consumer adds
 *  the width is allowlisted at the fragment, with the reason. */
const EDGE_RE = /(?:^|\s)(?:border(?:-[lrtbxy])?(?:-\d)?|ring(?:-\d)?|inset-ring(?:-\d)?|outline(?:-\d)?|outline-solid)(?=\s|$)/
const NO_EDGE_RE = /(?:^|\s)(?:border-0|border-none|ring-0|outline-none)(?=\s|$)/
/** Chip-shaped: a small rounded inline box. Everything else tinted is a banner/panel. */
const CHIP_SHAPE_RE = /(?:^|\s)(?:py-px|py-0|py-0\.5|h-3\.5|h-4|h-5|leading-none|leading-tight|leading-4|text-2xs|text-3xs)(?=\s|$)/
const STATE_PREFIX_RE = /^(?:[a-z0-9-]+:)+/

const SKIP_FILES = new Set(['lib/chipTone.ts', 'lib/actionIntent.ts'])

function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else if (/\.(tsx|ts)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p)
  }
  return out
}

/** Class strings with their 1-based start line. Template holes become spaces. */
function classStrings(src) {
  const out = []
  const re = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g
  for (const m of src.matchAll(re)) {
    let body = m[1] ?? m[2] ?? m[3] ?? ''
    if (m[3] !== undefined) body = body.replace(/\$\{[^}]*\}/g, ' ')
    if (!body.includes('bg-')) continue
    // A template that spans comments or code is not a class string.
    if (/\/\*|\*\/|=>|;\s/.test(body)) continue
    out.push({ body, line: src.slice(0, m.index).split('\n').length })
  }
  return out
}

function atRestClasses(body) {
  return body
    .split(/\s+/)
    .filter((c) => c && !STATE_PREFIX_RE.test(c))
    .join(' ')
}

function hasTextColour(classes) {
  for (const c of classes.split(' ')) {
    const m = /^text-([a-z0-9-]+)(?:\/[\d.]+)?$/.exec(c)
    if (m && !TEXT_SIZE_WORDS.has(m[1]) && !/^\[/.test(m[1])) return true
  }
  return false
}

function classify(classes) {
  const sem = TINT_SEM_RE.test(` ${classes} `) || TINT_ST_RE.test(` ${classes} `)
  const neutral = TINT_NEUTRAL_RE.test(` ${classes} `)
  if (!sem && !neutral) return null
  if (!hasTextColour(classes)) return null
  const hasEdge = EDGE_RE.test(` ${classes} `) && !NO_EDGE_RE.test(` ${classes} `)
  if (hasEdge) return null
  const chip = CHIP_SHAPE_RE.test(` ${classes} `) || /(?:^|\s)rounded(?:-[a-z0-9]+)?(?=\s|$)/.test(` ${classes} `)
  // A neutral grey fill is only a highlighter when it is chip-shaped; a grey panel is a surface.
  if (!sem && !CHIP_SHAPE_RE.test(` ${classes} `)) return null
  return { pattern: `${sem ? 'semantic' : 'neutral'}-${chip ? 'chip' : 'banner'}` }
}

const findings = []
for (const file of walk(ADMIN_SRC)) {
  const rel = relative(ADMIN_SRC, file).replace(/\\/g, '/')
  if (SKIP_FILES.has(rel)) continue
  const src = readFileSync(file, 'utf8')
  const lines = src.split('\n')
  for (const { body, line } of classStrings(src)) {
    const hit = classify(atRestClasses(body))
    if (!hit) continue
    const here = lines[line - 1] ?? ''
    const above = lines[line - 2] ?? ''
    if (/mushi-mushi-allowlist:/.test(here) || /mushi-mushi-allowlist:/.test(above)) continue
    findings.push({ file: rel, line, pattern: hit.pattern, classes: atRestClasses(body).slice(0, 160) })
  }
}

// Inline-style backgrounds behind text (style={{ background… }} next to color).
const styleFindings = []
for (const file of walk(ADMIN_SRC)) {
  const rel = relative(ADMIN_SRC, file).replace(/\\/g, '/')
  const lines = readFileSync(file, 'utf8').split('\n')
  lines.forEach((l, i) => {
    if (/style=\{\{[^}]*background(?:Color)?:[^}]*\bcolor:/.test(l) && !/mushi-mushi-allowlist:/.test(l + (lines[i - 1] ?? ''))) {
      styleFindings.push({ file: rel, line: i + 1, pattern: 'inline-style-bg+color' })
    }
  })
}

const all = [...findings, ...styleFindings]
const byPattern = {}
const byFile = {}
for (const f of all) {
  byPattern[f.pattern] = (byPattern[f.pattern] ?? 0) + 1
  byFile[f.file] = (byFile[f.file] ?? 0) + 1
}

if (asJson) {
  console.log(JSON.stringify({ total: all.length, byPattern, byFile, findings: all }, null, 2))
  process.exit(0)
}

if (all.length === 0) {
  console.log('[ok] No bare tinted text in admin src (every tinted chip/banner has an edge or a recipe)')
  process.exit(0)
}

console.error(`[fail] ${all.length} bare tinted-text class string(s) — use CHIP_TONE / Badge / SeverityPill / Callout:`)
for (const [p, n] of Object.entries(byPattern)) console.error(`  ${p}: ${n}`)
for (const f of all.slice(0, 80)) console.error(`  ${f.file}:${f.line}  [${f.pattern}]  ${f.classes ?? ''}`)
if (all.length > 80) console.error(`  … and ${all.length - 80} more`)
process.exit(strict ? 1 : 0)
