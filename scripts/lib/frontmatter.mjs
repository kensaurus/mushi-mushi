/**
 * FILE: scripts/lib/frontmatter.mjs
 * PURPOSE: Read the YAML front matter of a docs `.mdx` page for the generated
 *          LLM surfaces (llms.txt, llms-full.txt) and the docs meta checks.
 *
 * The generators used to pull `title:` with `/^title:\s*['"]?([^'"\n]+)/`,
 * which stops at the first apostrophe: "Here's what the data said" came out as
 * "Here". This reads the YAML subset the docs actually use instead — top-level
 * `key: value` scalars, plain, single-quoted (`''` escape) or double-quoted
 * (JSON-style escapes), plus `>` / `|` block scalars. Indented and list lines
 * belong to nested values the generators never read, so they are skipped.
 * No dependency: root scripts cannot import a YAML library under pnpm.
 */

const OPEN = /^---\r?\n/
const CLOSE = /\r?\n---[ \t]*(?:\r?\n|$)/
const KEY_LINE = /^([A-Za-z_][A-Za-z0-9_-]*):(?:[ \t]+(.*))?$/

/** Parse one inline YAML scalar. Returns the string value (never throws). */
function parseScalar(raw) {
  const value = raw.trim()
  if (value.startsWith("'")) {
    const end = value.lastIndexOf("'")
    const inner = end > 0 ? value.slice(1, end) : value.slice(1)
    return inner.replace(/''/g, "'")
  }
  if (value.startsWith('"')) {
    const end = value.lastIndexOf('"')
    const quoted = end > 0 ? value.slice(0, end + 1) : `${value}"`
    try {
      return String(JSON.parse(quoted))
    } catch {
      return quoted.slice(1, -1)
    }
  }
  // Plain scalar: ` #` starts a comment.
  const hash = value.search(/\s#/)
  return (hash === -1 ? value : value.slice(0, hash)).trim()
}

/**
 * Split an MDX source into its front matter (top-level scalars only) and body.
 * A file without a leading `---` block yields `{ data: {}, body: src }`.
 *
 * @param {string} src
 * @returns {{ data: Record<string, string>, body: string }}
 */
export function parseFrontmatter(src) {
  if (!OPEN.test(src)) return { data: {}, body: src }
  const afterOpen = src.replace(OPEN, '')
  const close = CLOSE.exec(afterOpen)
  if (!close) return { data: {}, body: src }
  const block = afterOpen.slice(0, close.index)
  const body = afterOpen.slice(close.index + close[0].length)

  /** @type {Record<string, string>} */
  const data = {}
  const lines = block.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim() || line.trimStart().startsWith('#') || /^[ \t-]/.test(line)) continue
    const m = KEY_LINE.exec(line)
    if (!m) continue
    const [, key, rawValue = ''] = m
    const indicator = rawValue.trim()
    if (/^[>|][+-]?$/.test(indicator)) {
      // Block scalar: gather the indented lines that follow.
      const collected = []
      while (i + 1 < lines.length && (/^[ \t]/.test(lines[i + 1]) || !lines[i + 1].trim())) {
        collected.push(lines[++i].trim())
      }
      while (collected.length && !collected[collected.length - 1]) collected.pop()
      data[key] = indicator.startsWith('>')
        ? collected.join(' ').replace(/\s+/g, ' ').trim()
        : collected.join('\n')
      continue
    }
    if (!indicator) continue // nested map or list — not a scalar the generators use
    data[key] = parseScalar(rawValue)
  }
  return { data, body }
}
