#!/usr/bin/env node
/**
 * FILE: scripts/check-design-tokens.mjs
 * PURPOSE: Lint guard — fail the build when admin source introduces a
 *          Tailwind class that references a semantic color token that
 *          doesn't exist in `apps/admin/src/index.css`.
 *
 *          The 2026-04-21 coherency sweep found three invisible-token
 *          bugs (`bg-surface-subtle`, `text-success`) that rendered
 *          transparently in production because Tailwind silently drops
 *          classes whose `--color-*` variable is undefined. This script
 *          stops the next one at commit time.
 *
 *          The type-floor check (11px minimum) is also applied to:
 *            - packages/marketing-ui/src   (marketing components)
 *            - apps/docs/components         (docs MDX components)
 *          These surfaces use `--mushi-*` brand tokens, not the admin
 *          @theme layer, so the semantic-token check is skipped for
 *          them — only the font-size floor is enforced.
 *
 *          Strategy: deny-list of retired / never-defined semantic aliases
 *          plus an allow-list of semantic roots that actually exist in the
 *          @theme block. A Tailwind class is flagged when:
 *
 *            (a) its token matches a deny-list prefix, OR
 *            (b) its token starts with a known semantic namespace
 *                (brand, accent, ok, warn, danger, info, surface, fg,
 *                edge, nav, overlay) but the full root isn't defined in
 *                index.css — i.e. a typo against a real namespace.
 *
 *          Run locally:  node scripts/check-design-tokens.mjs
 *          In CI:        pnpm check:design-tokens
 *          Pre-commit:   wired via scripts/install-git-hooks.mjs
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join, relative } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const ADMIN_SRC = resolve(ROOT, 'apps/admin/src')
const TOKEN_CSS = resolve(ADMIN_SRC, 'index.css')

// Additional directories whose source gets the type-floor check only
// (they use --mushi-* CSS vars, NOT the admin @theme layer, so the
// semantic-token allow-list check is intentionally skipped for them).
const TYPE_FLOOR_EXTRA_DIRS = [
  resolve(ROOT, 'packages/marketing-ui/src'),
  resolve(ROOT, 'apps/docs/components'),
  resolve(ROOT, 'apps/testers'),
]

// Raw Tailwind palette deny-list for surfaces that use --mushi-* brand tokens
// (marketing-ui, docs, public testers marketplace) — not the admin @theme layer.
const PALETTE_COLOR_NAMES = [
  'slate', 'gray', 'zinc', 'neutral', 'stone',
  'red', 'orange', 'amber', 'yellow',
  'lime', 'green', 'emerald', 'teal', 'cyan',
  'sky', 'blue', 'indigo', 'violet', 'purple',
  'fuchsia', 'pink', 'rose',
]
const PALETTE_PREFIXES = ['bg', 'text', 'border', 'ring', 'fill', 'stroke', 'from', 'to', 'via', 'divide', 'shadow', 'outline', 'decoration', 'placeholder', 'caret', 'accent']
const PALETTE_SHADE_RE = /^(50|[1-9]00|950)$/

function extractRawPaletteHits(src, file) {
  const hits = []
  const prefixAlt = PALETTE_PREFIXES.join('|')
  const colorAlt = PALETTE_COLOR_NAMES.join('|')
  // Match bg-gray-950, text-violet-400, hover:bg-white/5 (white/black without shade)
  const withShade = new RegExp(
    `(?<=[\\s"'\`{}\\[\\]=>:;(])((?:hover:|focus:|focus-visible:|active:|dark:|sm:|md:|lg:|xl:|2xl:|motion-safe:|group-hover:)*)(?:${prefixAlt})-(?:${colorAlt})-(\\d+|950)(?:\\/\\d+)?(?=[\\s"'\`{}\\[\\]=>:;)])`,
    'g',
  )
  const whiteBlack = new RegExp(
    `(?<=[\\s"'\`{}\\[\\]=>:;(])((?:hover:|focus:|focus-visible:|active:|dark:|sm:|md:|lg:|xl:|2xl:|motion-safe:|group-hover:)*)(?:${prefixAlt})-(?:white|black)(?:\\/\\d+)?(?=[\\s"'\`{}\\[\\]=>:;)])`,
    'g',
  )
  for (const re of [withShade, whiteBlack]) {
    for (const match of src.matchAll(re)) {
      const index = match.index ?? 0
      const lineStart = src.lastIndexOf('\n', index) + 1
      const linePrefix = src.slice(lineStart, index)
      if (/mushi-mushi-allowlist:/i.test(linePrefix)) continue
      hits.push({ token: match[0].trim(), file, index })
    }
  }
  return hits
}

// Sub-directories and file name patterns exempt from the type-floor scan.
// These are data-visualization components (canvas node labels, inline SVG
// diagrams) where sub-11px text is intentional and governed by the diagram
// layout rather than the UI typography system.
const TYPE_FLOOR_EXEMPT_SUBDIRS = new Set(['canvas'])
const TYPE_FLOOR_EXEMPT_FILE_RE = /(Diagram|Flow|Pipeline|LoopComparison|Comparison|Chart|Sparkline|Ticker)\.tsx?$/

// Retired / never-existed aliases. Matched as a whole root or as a prefix
// before a hyphen (so `text-success-muted` is caught too).
const DENY = [
  'surface-subtle',
  'success',
  'error',
]

// Known semantic color namespaces. A Tailwind class whose root starts with
// one of these is expected to resolve to a `--color-<root>` variable; if
// the full root isn't in the allow-list extracted from index.css, it's a
// typo drift and we fail the build.
const SEMANTIC_NAMESPACES = [
  'brand',
  'accent',
  'ok',
  'warn',
  'warning',
  'danger',
  'info',
  'surface',
  'fg',
  'edge',
  'nav',
  'overlay',
  'border',
  'background',
  'chrome',
  'viz',
]

// Tailwind class prefixes that *can* take a semantic color token. We only
// examine classes starting with one of these to avoid false positives on
// size / layout utilities like `text-xs`, `border-b`, `ring-2`.
const COLOR_PREFIXES = ['bg', 'text', 'border', 'ring', 'fill', 'stroke', 'from', 'to', 'via', 'divide', 'shadow', 'outline', 'decoration', 'placeholder', 'caret', 'accent']

function parseColorRoots(css) {
  const roots = new Set()
  for (const match of css.matchAll(/--color-([a-z0-9-]+):/g)) {
    roots.add(match[1])
  }
  return roots
}

function walk(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue
    const path = join(dir, entry)
    const info = statSync(path)
    if (info.isDirectory()) walk(path, acc)
    else if (/\.(tsx?|css)$/.test(entry)) acc.push(path)
  }
  return acc
}

function extractSemanticColorHits(src, file, allow) {
  const deniedHits = []
  const unknownHits = []
  const prefixAlt = COLOR_PREFIXES.join('|')
  // Match `<prefix>-<root>` where root is letters/hyphens, optional /opacity.
  // Anchored to class-boundary chars (quote, whitespace, backtick, colon, {, }, [).
  const re = new RegExp(
    `(?<=[\\s"'\`{}\\[\\]=>:;(])(${prefixAlt})-([a-z][a-z0-9-]*?)(?:\\/\\d+)?(?=[\\s"'\`{}\\[\\]=>:;)])`,
    'g',
  )
  for (const match of src.matchAll(re)) {
    const root = match[2]
    const index = match.index ?? 0
    // Deny-list: whole token or leading segment matches a retired alias.
    const deniedBase = DENY.find(
      (d) => root === d || root.startsWith(`${d}-`) || root.endsWith(`-${d}`),
    )
    if (deniedBase) {
      deniedHits.push({ token: `${match[1]}-${root}`, file, index })
      continue
    }
    // Only inspect roots that start with a known semantic namespace.
    const leadingNs = root.split('-')[0]
    if (!SEMANTIC_NAMESPACES.includes(leadingNs)) continue
    if (allow.has(root)) continue
    // `brand-hover/40` → `brand-hover` already stripped. Try progressively
    // shorter prefixes so `bg-brand-hover` validates when only `brand-hover`
    // is defined (it is) AND `bg-brand` validates when `--color-brand` is
    // defined (it is). If no prefix matches, drift.
    const parts = root.split('-')
    let matched = false
    for (let i = parts.length - 1; i >= 1; i -= 1) {
      if (allow.has(parts.slice(0, i).join('-'))) {
        matched = true
        break
      }
    }
    if (!matched) {
      unknownHits.push({ token: `${match[1]}-${root}`, file, index })
    }
  }
  return { deniedHits, unknownHits }
}

const css = readFileSync(TOKEN_CSS, 'utf8')
const allow = parseColorRoots(css)
const files = walk(ADMIN_SRC)

const denied = []
const unknown = []

for (const file of files) {
  if (file === TOKEN_CSS) continue
  const src = readFileSync(file, 'utf8')
  const { deniedHits, unknownHits } = extractSemanticColorHits(src, file, allow)
  for (const hit of deniedHits) {
    const line = src.slice(0, hit.index).split('\n').length
    denied.push({ ...hit, line })
  }
  for (const hit of unknownHits) {
    const line = src.slice(0, hit.index).split('\n').length
    unknown.push({ ...hit, line })
  }
}

function fmt(hit) {
  const rel = relative(ROOT, hit.file).replace(/\\/g, '/')
  return `  ${rel}:${hit.line}  ${hit.token}`
}

if (denied.length > 0) {
  console.error(`\n[drift] Retired design tokens found — these render transparently:\n`)
  for (const hit of denied) console.error(fmt(hit))
  console.error(
    `\nFix: use the live semantic tokens defined in apps/admin/src/index.css.\n` +
      `  success*        → ok*      (bg-ok-muted / text-ok / border-ok)\n` +
      `  error*          → danger*  (bg-danger-muted / text-danger / border-danger)\n` +
      `  surface-subtle  → surface-raised/30  (canonical inset-panel pattern)\n`,
  )
}

if (unknown.length > 0) {
  console.error(`\n[drift] Tailwind classes reference undefined semantic tokens:\n`)
  for (const hit of unknown) console.error(fmt(hit))
  console.error(
    `\nFix: add the token to the @theme block in apps/admin/src/index.css,\n` +
      `or switch to an existing root: ${[...allow].slice(0, 12).join(', ')}, …\n`,
  )
}

// ── Typography floor check ───────────────────────────────────────────────
// Detect hard-coded sub-floor font sizes that bypass the token layer.
// Floor: 12px (--text-2xs) for interactive elements (enforced by ESLint rule).
// Sub-floor: 11px (--text-3xs) — anything strictly below 11px is a build error.
// Also scans packages/marketing-ui/src and apps/docs/components.
//
// Flagged patterns (TSX/TS only):
//   text-[Xpx]       where X < 11
//   text-[X.Xrem]    where value < 0.6875rem (11px)
//   fontSize: 'Xpx'  where X < 11
//   fontSize: X       where X < 11 (numeric, JS-in-CSS)
// CSS files: font-size: Xpx or X.Xrem below floor.

function extractLineNumber(src, index) {
  return src.slice(0, index).split('\n').length
}

const subFloorHits = []

// Walk a directory for the type-floor extra scan, respecting visualization
// exemptions (canvas nodes, SVG diagram components).
function walkForTypeFloor(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue
    if (TYPE_FLOOR_EXEMPT_SUBDIRS.has(entry)) continue
    const path = join(dir, entry)
    const info = statSync(path)
    if (info.isDirectory()) {
      walkForTypeFloor(path, acc)
    } else if (/\.(tsx?|css)$/.test(entry)) {
      if (!TYPE_FLOOR_EXEMPT_FILE_RE.test(entry)) acc.push(path)
    }
  }
  return acc
}

// Collect all files for the type-floor scan (admin + marketing-ui + docs/components)
const typeFloorFiles = [...files]
for (const extraDir of TYPE_FLOOR_EXTRA_DIRS) {
  try {
    typeFloorFiles.push(...walkForTypeFloor(extraDir))
  } catch {
    // dir may not exist in some checkouts — skip gracefully
  }
}

for (const file of typeFloorFiles) {
  if (file === TOKEN_CSS) continue
  if (!/\.(tsx?|css)$/.test(file)) continue
  const src = readFileSync(file, 'utf8')

  // text-[Xpx] where X < 11 (strictly below text-3xs floor)
  for (const m of src.matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g)) {
    if (parseFloat(m[1]) < 11) {
      subFloorHits.push({ file, line: extractLineNumber(src, m.index), token: m[0] })
    }
  }

  // text-[X.Xrem] where value < 0.6875 (11px = text-3xs floor)
  for (const m of src.matchAll(/text-\[(\d+\.\d+)rem\]/g)) {
    if (parseFloat(m[1]) < 0.6875) {
      subFloorHits.push({ file, line: extractLineNumber(src, m.index), token: m[0] })
    }
  }

  // fontSize: 'Xpx' (inline style) — below 11px floor
  for (const m of src.matchAll(/fontSize:\s*['"](\d+(?:\.\d+)?)px['"]/g)) {
    if (parseFloat(m[1]) < 11) {
      subFloorHits.push({ file, line: extractLineNumber(src, m.index), token: `fontSize: '${m[1]}px'` })
    }
  }

  // fontSize: X (numeric JS) — below 11px floor
  for (const m of src.matchAll(/fontSize:\s*(\d+(?:\.\d+)?)(?=[,\s}])/g)) {
    if (parseFloat(m[1]) < 11 && parseFloat(m[1]) > 0) {
      subFloorHits.push({ file, line: extractLineNumber(src, m.index), token: `fontSize: ${m[1]}` })
    }
  }
}

if (subFloorHits.length > 0) {
  console.error(`\n[type-floor] Hard-coded sub-floor font sizes detected (minimum: 12px / text-2xs):\n`)
  for (const hit of subFloorHits) {
    const rel = relative(ROOT, hit.file).replace(/\\/g, '/')
    console.error(`  ${rel}:${hit.line}  ${hit.token}`)
  }
  console.error(
    `\nFix: use text-3xs (11px) or larger. ` +
    `text-3xs is the absolute floor for any visible text.\n` +
    `  For interactive labels (button/input/label/th/td): minimum text-2xs (12px).\n` +
    `  Replace text-[Xpx] / text-[Xrem] with text-3xs or text-2xs tokens.\n`,
  )
}

// ── Raw palette check (apps/testers marketplace only) ────────────────────
const TESTERS_SRC = resolve(ROOT, 'apps/testers')
const paletteHits = []
try {
  for (const file of walkForTypeFloor(TESTERS_SRC)) {
    if (!/\.tsx?$/.test(file)) continue
    const src = readFileSync(file, 'utf8')
    for (const hit of extractRawPaletteHits(src, file)) {
      paletteHits.push({ ...hit, line: extractLineNumber(src, hit.index) })
    }
  }
} catch {
  // testers app may not exist in some checkouts
}

if (paletteHits.length > 0) {
  console.error(`\n[palette] Raw Tailwind palette classes in brand/marketing surfaces:\n`)
  for (const hit of paletteHits) {
    const rel = relative(ROOT, hit.file).replace(/\\/g, '/')
    console.error(`  ${rel}:${hit.line}  ${hit.token}`)
  }
  console.error(
    `\nFix: use --mushi-* CSS variables (bg-[var(--mushi-paper)], text-[var(--mushi-ink-muted)], etc.)\n` +
    `or admin @theme tokens on console pages. Allowlist with // mushi-mushi-allowlist: <reason>\n`,
  )
}

// ── Page hero duplication guard ───────────────────────────────────────────
// Pages that render both PageHeaderBar and the PageHero component must pass
// withPageHero on PageHeaderBar so the subtitle does not stack under the DAV
// hero strip. Match the JSX render (`<PageHero`) rather than the bare substring
// so the `usePublishPageHeroStats` hook (which only feeds the shared hero strip
// and renders no inline hero) is not flagged as a duplicate.
const heroDupHits = []
const PAGES_DIR = resolve(ADMIN_SRC, 'pages')
try {
  for (const file of walk(PAGES_DIR)) {
    if (!/\.tsx?$/.test(file)) continue
    const src = readFileSync(file, 'utf8')
    if (!src.includes('<PageHero') || !src.includes('PageHeaderBar')) continue
    if (src.includes('withPageHero')) continue
    heroDupHits.push(file)
  }
} catch {
  /* pages dir missing */
}

if (heroDupHits.length > 0) {
  console.error(`\n[hero-dup] PageHeaderBar + PageHero without withPageHero:\n`)
  for (const file of heroDupHits) {
    console.error(`  ${relative(ROOT, file).replace(/\\/g, '/')}`)
  }
  console.error(
    `\nFix: pass withPageHero on PageHeaderBar when the page renders PageHero, ` +
    `or gate PageHero to advanced-only mode.\n`,
  )
}

// ── Raw hex guard (admin src only) ───────────────────────────────────────
// SVG/canvas surfaces should read @theme viz-* tokens via readVizToken().
// Allowlist with // mushi-mushi-allowlist: <reason> on the preceding line.
const HEX_RE = /#(?:[0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})\b/g
const hexHits = []

for (const file of files) {
  if (!/\.tsx?$/.test(file)) continue
  if (file === TOKEN_CSS) continue
  const src = readFileSync(file, 'utf8')
  for (const match of src.matchAll(HEX_RE)) {
    const index = match.index ?? 0
    const lineStart = src.lastIndexOf('\n', index) + 1
    const lineNum = extractLineNumber(src, index)
    const lines = src.split('\n')
    const contextStart = Math.max(0, lineNum - 25)
    const contextBlock = lines.slice(contextStart, lineNum).join('\n')
    const linePrefix = src.slice(lineStart, index)
    if (/mushi-mushi-allowlist:/i.test(linePrefix) || /mushi-mushi-allowlist:/i.test(contextBlock)) continue
    hexHits.push({ file, line: lineNum, token: match[0] })
  }
}

if (hexHits.length > 0) {
  console.error(`\n[hex] Raw hex colours in admin source — use @theme viz-* + readVizToken():\n`)
  for (const hit of hexHits) {
    const rel = relative(ROOT, hit.file).replace(/\\/g, '/')
    console.error(`  ${rel}:${hit.line}  ${hit.token}`)
  }
  console.error(
    `\nFix: add a viz-* token in index.css and read it via apps/admin/src/lib/vizTokens.ts,\n` +
    `or allowlist with // mushi-mushi-allowlist: <reason> when exact brand hex is required.\n`,
  )
}

// ── Light/dark theme pair guard ───────────────────────────────────────────
// Tokens that must appear in at least one html[data-theme="light"] block.
const THEME_PAIR_REQUIRED = [
  'code-kw',
  'code-str',
  'code-cmd',
  'code-type',
  'code-tag',
  'code-attr',
  'viz-canvas-bg',
  'viz-canvas-dot',
]

function parseLightThemeRoots(css) {
  const roots = new Set()
  for (const match of css.matchAll(/html\[data-theme="light"\][^{]*\{([^}]+)\}/g)) {
    for (const m of match[1].matchAll(/--color-([a-z0-9-]+):/g)) {
      roots.add(m[1])
    }
  }
  return roots
}

const lightRoots = parseLightThemeRoots(css)
const themePairMissing = THEME_PAIR_REQUIRED.filter((t) => !lightRoots.has(t))

if (themePairMissing.length > 0) {
  console.error(`\n[theme-pair] Missing light-mode overrides in index.css:\n`)
  for (const t of themePairMissing) {
    console.error(`  --color-${t}`)
  }
  console.error(`\nFix: add each token under html[data-theme="light"] { … } in apps/admin/src/index.css\n`)
}

if (denied.length > 0 || unknown.length > 0 || subFloorHits.length > 0 || paletteHits.length > 0 || heroDupHits.length > 0 || hexHits.length > 0 || themePairMissing.length > 0) process.exit(1)

const totalTypeFloorFiles = typeFloorFiles.length
console.log(`[ok] Admin design tokens are in sync with index.css (${allow.size} color roots, ${files.length} admin files scanned). Type floor: clean across ${totalTypeFloorFiles} files. Palette guard: clean on apps/testers. Hex guard: clean.`)
