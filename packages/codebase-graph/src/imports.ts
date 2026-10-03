/**
 * Import specifiers in source text, found with a single left-to-right scan
 * instead of a regular expression, so the cost stays linear on any input
 * (a regex with overlapping whitespace quantifiers backtracks polynomially on
 * `import` followed by a long run of whitespace).
 *
 * Recognised, in source order:
 *   import x from './a'      import { a, b } from "./b"     import type T from './t'
 *   import './side-effect'   require('./c')                require( "./d" )
 * As before, `from` must follow whitespace and be followed by whitespace
 * before the quote.
 */

function isSpace(ch: string | undefined): boolean {
  return ch !== undefined && /\s/.test(ch)
}

function isQuote(ch: string | undefined): boolean {
  return ch === '"' || ch === "'"
}

/** Every import / require specifier in `src`, duplicates included, in order. */
export function scanImportSpecifiers(src: string): string[] {
  const n = src.length
  if (src.indexOf('import') === -1 && src.indexOf('require') === -1) return []

  // nextQuote[i]: the first quote at or after i (n when none).
  // spaceRunStart[i]: the start of the whitespace run that ends just before i.
  // Both are O(1) lookups, so retrying at the next token never rescans text.
  const nextQuote = new Int32Array(n + 1)
  nextQuote[n] = n
  for (let i = n - 1; i >= 0; i--) nextQuote[i] = isQuote(src[i]) ? i : nextQuote[i + 1]
  const spaceRunStart = new Int32Array(n + 1)
  for (let i = 1; i <= n; i++) spaceRunStart[i] = isSpace(src[i - 1]) ? spaceRunStart[i - 1] : i

  /** The specifier in the string literal opening at `q`, and the index past it. */
  const literalAt = (q: number): { spec: string; end: number } | null => {
    const close = nextQuote[q + 1]
    if (close >= n || close === q + 1) return null
    return { spec: src.slice(q + 1, close), end: close + 1 }
  }

  /** `import <clause>? '<spec>'` at `at`, or null. */
  const importAt = (at: number): { spec: string; end: number } | null => {
    let j = at + 'import'.length
    if (!isSpace(src[j])) return null
    while (isSpace(src[j])) j++
    const q = nextQuote[j]
    if (q >= n) return null
    if (q > j) {
      // The clause must end in whitespace, `from`, whitespace.
      const e = Math.max(spaceRunStart[q], j)
      if (!(e < q && e - 4 > j && src.slice(e - 4, e) === 'from' && isSpace(src[e - 5]))) return null
    }
    return literalAt(q)
  }

  /** `require ( '<spec>' )` at `at`, or null. */
  const requireAt = (at: number): { spec: string; end: number } | null => {
    let j = at + 'require'.length
    while (isSpace(src[j])) j++
    if (src[j] !== '(') return null
    j++
    while (isSpace(src[j])) j++
    const lit = isQuote(src[j]) ? literalAt(j) : null
    if (!lit) return null
    let k = lit.end
    while (isSpace(src[k])) k++
    return src[k] === ')' ? { spec: lit.spec, end: k + 1 } : null
  }

  const out: string[] = []
  let nextImport = src.indexOf('import')
  let nextRequire = src.indexOf('require')
  let i = 0
  while (i < n) {
    if (nextImport !== -1 && nextImport < i) nextImport = src.indexOf('import', i)
    if (nextRequire !== -1 && nextRequire < i) nextRequire = src.indexOf('require', i)
    if (nextImport === -1 && nextRequire === -1) break
    const isImport = nextImport !== -1 && (nextRequire === -1 || nextImport < nextRequire)
    const at = isImport ? nextImport : nextRequire
    const hit = isImport ? importAt(at) : requireAt(at)
    if (hit) {
      out.push(hit.spec)
      i = hit.end
    } else {
      i = at + 1
    }
  }
  return out
}
