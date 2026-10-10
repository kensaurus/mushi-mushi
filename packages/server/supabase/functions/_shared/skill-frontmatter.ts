/**
 * Pure SKILL.md parsing for skill-sync: frontmatter, category and the skill
 * chain a pipeline runs. No Deno or network dependencies, so the Deno and
 * vitest suites import the real code instead of copies.
 */

/**
 * Parse YAML frontmatter: `key: value` pairs, block scalars (> >- | |-) and
 * one level of nested map (`metadata:` with indented `key: value` lines,
 * stored as `metadata.key`). The Agent Skills spec only requires name and
 * description; `metadata` is its map of string keys to string values.
 */
export function parseFrontmatter(raw: string): { frontmatter: Record<string, string>; body: string } | null {
  const trimmed = raw.trimStart()
  if (!trimmed.startsWith('---')) return null

  const endIdx = trimmed.indexOf('\n---', 3)
  if (endIdx === -1) return null

  const fmBlock = trimmed.slice(4, endIdx)
  const body = trimmed.slice(endIdx + 4).trimStart()

  const frontmatter: Record<string, string> = {}
  const lines = fmBlock.split('\n').map((l) => l.replace(/\r$/, ''))
  const unquote = (v: string) => v.replace(/^["']|["']$/g, '')
  const indented = (l: string) => l.startsWith(' ') || l.startsWith('\t')
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const colonIdx = line.indexOf(':')
    if (colonIdx === -1 || indented(line)) { i++; continue }

    const key = line.slice(0, colonIdx).trim()
    const rawVal = line.slice(colonIdx + 1).trim()

    if (rawVal === '>' || rawVal === '>-' || rawVal === '|' || rawVal === '|-') {
      // Block scalar: fold the indented lines into one value.
      const parts: string[] = []
      i++
      while (i < lines.length && indented(lines[i])) {
        parts.push(lines[i].trim())
        i++
      }
      if (key) frontmatter[key] = parts.filter((p) => p !== '').join(' ')
    } else if (rawVal === '') {
      // Nested map: `metadata:` followed by indented `key: value` lines.
      i++
      while (i < lines.length && (indented(lines[i]) || lines[i].trim() === '')) {
        const sub = lines[i].trim()
        const subColon = sub.indexOf(':')
        if (subColon > 0 && key) {
          frontmatter[`${key}.${sub.slice(0, subColon).trim()}`] = unquote(sub.slice(subColon + 1).trim())
        }
        i++
      }
    } else {
      if (key) frontmatter[key] = unquote(rawVal)
      i++
    }
  }

  return { frontmatter, body }
}

/** Agent Skills spec: a description is at most 1024 characters. */
export const SKILL_DESCRIPTION_MAX = 1024

/** The description as skill-sync stores it, cut to {@link SKILL_DESCRIPTION_MAX}. */
export function capSkillDescription(description: string): string {
  return description.slice(0, SKILL_DESCRIPTION_MAX)
}

/** Catalog category from the slug prefix (`workflow-fix-and-ship` → workflow). */
export function categoryFromSlug(slug: string): string {
  const dash = slug.indexOf('-')
  if (dash === -1) return 'other'
  const prefix = slug.slice(0, dash)
  const known = ['workflow', 'debug', 'test', 'audit', 'enhance', 'backend',
                 'design', 'deploy', 'data', 'mobile', 'docs', 'meta', 'mushi',
                 'protocol', 'iterate', 'plan', 'housekeep']
  return known.includes(prefix) ? prefix : 'other'
}

const SLUG = /^[a-z][a-z0-9-]{1,63}$/
/** `skills/<slug>/SKILL.md` or `~/.cursor/skills/<slug>/SKILL.md`. */
const PATH_RE = /(?:skills?|~\/\.cursor\/skills?)\/([a-z][a-z0-9-]{1,63})\/SKILL\.md/g
/** "Read the `debug-error` skill" — how workflow skills hand off a step. */
const READ_SKILL_RE = /\bRead the `([a-z][a-z0-9-]{1,63})` skill\b/gi

/**
 * The skills a pipeline runs after this one, in order.
 *
 * `metadata.chain` (space- or comma-separated slugs) is authoritative when
 * present. Otherwise the chain comes from the body: `Read the \`x\` skill`
 * hand-offs and `skills/x/SKILL.md` paths, in the order they appear. Body
 * mentions are kept only when they name a skill in `knownSlugs`, so prose
 * like "Read the `README` skill" or a neighbour from another repo does not
 * become a step. The skill itself is never in its own chain. Only a
 * `workflow-*` skill falls back to its body: other skills mention neighbours
 * and guardrails ("Read the `protocol-browser-anti-stall` skill") that are
 * not steps to run.
 */
export function parseChainSlugs(
  body: string,
  frontmatter: Record<string, string> = {},
  opts: { selfSlug?: string; knownSlugs?: ReadonlySet<string> } = {},
): string[] {
  const { selfSlug, knownSlugs } = opts
  const out: string[] = []
  const add = (slug: string | undefined, requireKnown: boolean) => {
    if (!slug || !SLUG.test(slug) || slug === selfSlug || out.includes(slug)) return
    if (requireKnown && knownSlugs && !knownSlugs.has(slug)) return
    out.push(slug)
  }

  const declared = frontmatter['metadata.chain']
  if (declared !== undefined) {
    for (const slug of declared.split(/[\s,]+/)) add(slug.trim(), true)
    return out
  }

  if (selfSlug && !selfSlug.startsWith('workflow-')) return out

  const hits: Array<{ at: number; slug: string }> = []
  for (const m of body.matchAll(PATH_RE)) hits.push({ at: m.index ?? 0, slug: m[1] })
  for (const m of body.matchAll(READ_SKILL_RE)) hits.push({ at: m.index ?? 0, slug: m[1].toLowerCase() })
  hits.sort((a, b) => a.at - b.at)
  for (const h of hits) add(h.slug, true)
  return out
}
