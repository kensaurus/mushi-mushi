/**
 * FILE: scripts/lib/viz-token-reads.mjs
 * PURPOSE: Find the `--color-viz-*` token names admin source declares or
 *          reads, for the viz CSS gate in scripts/check-design-tokens.mjs.
 */

// A trailing hyphen (the glob in `--color-viz-layer-*`) is not a token name.
const VIZ_TOKEN = String.raw`[a-z0-9]+(?:-[a-z0-9]+)*`
const VIZ_DECL_RE = new RegExp(String.raw`--color-viz-(${VIZ_TOKEN})(?![a-z0-9-])\s*:`, 'g')
const VIZ_VAR_RE = new RegExp(String.raw`var\(\s*--color-viz-(${VIZ_TOKEN})(?![a-z0-9-])`, 'g')
const VIZ_LITERAL_RE = new RegExp(String.raw`['"\`]viz-(${VIZ_TOKEN})['"\`]`, 'g')
const VIZ_READER_IMPORT_RE = /\bfrom\s+['"][^'"]*\/vizTokens(?:\.tsx?)?['"]/

function namesIn(src, re, into = new Set()) {
  for (const match of src.matchAll(re)) into.add(match[1])
  return into
}

/** Token names declared (`--color-viz-x: …`) in a stylesheet or compiled CSS. */
export function vizTokensDeclared(css) {
  return namesIn(css, VIZ_DECL_RE)
}

/**
 * Token names a TS/TSX module reads: `var(--color-viz-x)` anywhere, and
 * `'viz-x'` string literals only in vizTokens.ts or modules importing it,
 * where such a literal is a readVizToken() name. A class name or other
 * `viz-` string elsewhere is not a token read.
 */
export function vizTokenReads(src, { isVizReader = false } = {}) {
  const names = namesIn(src, VIZ_VAR_RE)
  if (isVizReader || VIZ_READER_IMPORT_RE.test(src)) namesIn(src, VIZ_LITERAL_RE, names)
  return names
}
