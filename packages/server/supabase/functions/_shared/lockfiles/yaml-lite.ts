/**
 * FILE: _shared/lockfiles/yaml-lite.ts
 * PURPOSE: The YAML subset that machine-written lockfiles use (pnpm-lock.yaml,
 *          yarn berry's yarn.lock): nested block mappings, plain or quoted
 *          scalars, block lists of scalars, flow collections kept as raw
 *          text, and block scalars (`|`, `>`) skipped. No anchors, no tags,
 *          no multi-document streams. Kept dependency-free: no YAML package.
 */

export type YamlValue = string | YamlMap | string[]
export interface YamlMap {
  [key: string]: YamlValue
}

function unquote(raw: string): string {
  const s = raw.trim()
  if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) return s.slice(1, -1).replace(/''/g, "'")
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    return s.slice(1, -1).replace(/\\(["\\/nt])/g, (_m, c: string) => (c === 'n' ? '\n' : c === 't' ? '\t' : c))
  }
  return s
}

/** Strip a trailing ` # comment` that is outside quotes. */
function stripComment(s: string): string {
  let quote: string | null = null
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (quote) {
      if (c === quote) quote = null
    } else if (c === '"' || c === "'") {
      quote = c
    } else if (c === '#' && (i === 0 || s[i - 1] === ' ')) {
      return s.slice(0, i).trimEnd()
    }
  }
  return s
}

/** Split `key: value` at the first `: ` (or a trailing `:`) outside quotes. */
function splitKey(line: string): { key: string; value: string } | null {
  let quote: string | null = null
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (quote) {
      if (c === '\\' && quote === '"') i++
      else if (c === quote) quote = null
      continue
    }
    if ((c === '"' || c === "'") && i === 0) {
      quote = c
      continue
    }
    if (c === ':' && (i === line.length - 1 || line[i + 1] === ' ')) {
      return { key: unquote(line.slice(0, i)), value: line.slice(i + 1).trim() }
    }
  }
  return null
}

interface Frame {
  indent: number
  map: YamlMap
  /** The key in the parent that holds `map`, so it can turn into a list. */
  parent: YamlMap | null
  key: string | null
}

/** Parse the lockfile YAML subset. Unrecognised lines are skipped, never thrown on. */
export function parseYamlLite(text: string): YamlMap {
  const root: YamlMap = {}
  const stack: Frame[] = [{ indent: -1, map: root, parent: null, key: null }]
  let skipDeeperThan: number | null = null
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  for (const rawLine of lines) {
    if (!rawLine.trim() || rawLine.trimStart().startsWith('#')) continue
    const indent = rawLine.length - rawLine.trimStart().length
    if (skipDeeperThan !== null) {
      if (indent > skipDeeperThan) continue
      skipDeeperThan = null
    }
    const line = stripComment(rawLine.trimStart())
    if (!line || line === '---') continue

    if (line.startsWith('- ') || line === '-') {
      // A list item belongs to the newest frame whose indent is below or at it.
      while (stack.length > 1 && stack[stack.length - 1].indent > indent) stack.pop()
      const top = stack[stack.length - 1]
      if (top.parent && top.key !== null) {
        const current = top.parent[top.key]
        const list = Array.isArray(current) ? current : []
        list.push(unquote(line.slice(1)))
        top.parent[top.key] = list
      }
      continue
    }

    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) stack.pop()
    const top = stack[stack.length - 1]
    const kv = splitKey(line)
    if (!kv) continue
    if (kv.value === '') {
      const child: YamlMap = {}
      top.map[kv.key] = child
      stack.push({ indent, map: child, parent: top.map, key: kv.key })
    } else if (/^[|>][+-]?\d*$/.test(kv.value)) {
      top.map[kv.key] = ''
      skipDeeperThan = indent
    } else {
      top.map[kv.key] = unquote(kv.value)
    }
  }
  return root
}

/** A child mapping, or an empty one. */
export function mapAt(v: YamlValue | undefined): YamlMap {
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {}
}

/** A scalar child, or null. */
export function strAt(v: YamlValue | undefined): string | null {
  return typeof v === 'string' ? v : null
}
