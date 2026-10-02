/**
 * FILE: packages/server/supabase/functions/_shared/recipe-glob.ts
 * PURPOSE: Repo-path safety and a small glob matcher for the App Recipe
 *          (Plan 019). The recipe-PR allowlist depends on both, so they are
 *          hand-rolled, dependency-free and tested in isolation.
 *
 * Glob syntax: `**` (any number of path segments, including none), `*` (any
 * run of characters inside one segment), `?` (one character inside a
 * segment) and `{a,b,c}` alternation (no nesting). Matching is case-sensitive,
 * like git on Linux. Everything else is literal.
 *
 * Kept byte-identical in packages/cli/src/recipe/recipe-glob.ts (`mushi recipe
 * check`), asserted by packages/server/src/__tests__/radar-repo-scan.test.ts.
 */

/**
 * Returns a canonical repo-relative path, or null when the path is unsafe:
 * empty, absolute, Windows-style, containing `..` / `.` segments, empty
 * segments, NUL or control characters, or any percent-encoding (so an encoded
 * traversal can never slip through a later decode).
 */
export function normalizeRepoPath(input: string): string | null {
  if (typeof input !== 'string') return null
  const p = input.trim()
  if (p.length === 0 || p.length > 512) return null
  if (p.startsWith('/') || p.startsWith('~')) return null
  if (p.includes('\\') || p.includes('%')) return null
  if (/^[A-Za-z]:/.test(p)) return null
  // deno-lint-ignore no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(p)) return null
  const segments = p.split('/')
  for (const seg of segments) {
    if (seg === '' || seg === '.' || seg === '..') return null
  }
  return segments.join('/')
}

function escapeRegex(ch: string): string {
  return /[.+^$()|[\]\\]/.test(ch) ? `\\${ch}` : ch
}

const regexCache = new Map<string, RegExp>()

/** Compile a glob to an anchored RegExp. Throws on an unbalanced `{`. @public (used by the CLI copy's matchGlob) */
export function globToRegExp(glob: string): RegExp {
  const cached = regexCache.get(glob)
  if (cached) return cached
  let out = ''
  let inBrace = false
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i]
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        // `**/` matches zero or more whole segments; a trailing `**` matches
        // anything below.
        if (glob[i + 2] === '/') {
          out += '(?:[^/]+/)*'
          i += 2
        } else {
          out += '.*'
          i += 1
        }
      } else {
        out += '[^/]*'
      }
    } else if (ch === '?') {
      out += '[^/]'
    } else if (ch === '{') {
      if (inBrace) throw new Error(`nested braces are not supported: ${glob}`)
      inBrace = true
      out += '(?:'
    } else if (ch === '}' && inBrace) {
      inBrace = false
      out += ')'
    } else if (ch === ',' && inBrace) {
      out += '|'
    } else {
      out += escapeRegex(ch)
    }
  }
  if (inBrace) throw new Error(`unbalanced brace in glob: ${glob}`)
  const re = new RegExp(`^${out}$`)
  regexCache.set(glob, re)
  return re
}

/** True when `path` matches `glob`. A malformed glob matches nothing. @public (used by matchAny in the CLI copy) */
export function matchGlob(path: string, glob: string): boolean {
  try {
    return globToRegExp(glob).test(path)
  } catch {
    return false
  }
}

export function matchAny(path: string, globs: readonly string[]): boolean {
  return globs.some((g) => matchGlob(path, g))
}
