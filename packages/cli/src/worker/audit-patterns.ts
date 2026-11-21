/**
 * FILE: packages/cli/src/worker/audit-patterns.ts
 * PURPOSE: The root-cause identity of a code-audit finding (ADR 0063).
 *
 *          2026-11-21: 550 open code_audit reports, about 312 of them the same
 *          handful of problems (a loading screen a screen reader cannot hear, a
 *          failed load shown as empty, a wrong count…) filed once per screen.
 *          The old key was file + free-text rule + a hash of one line, so every
 *          screen and every new slug was a new report. Two facts fix that:
 *
 *          1. A finding's category comes from a fixed taxonomy, not the model's
 *             slug (auditCategory). The server holds the same table
 *             (_shared/audit-taxonomy.ts); a test keeps the two equal.
 *          2. Its root is where one fix would land: the shared component the
 *             evidence line renders, else every route file of that kind
 *             (`app/** /loading.tsx`), else the file itself (patternRoot).
 *
 *          category + root is the pattern key: one open report per app and
 *          key, like GitHub code scanning's partialFingerprints (an identity
 *          that survives the code moving), not one per line.
 *
 *          And an `absent` check is not proven by one file alone: a page that
 *          renders a shared wrapper holding the missing attribute is fine
 *          (absentHeldByWrapper). glot's per-page loading screens stayed open
 *          after RouteLoadingShell gained its live region (2026-10-30, #935).
 */

import { posix } from 'node:path'

// ── Taxonomy ────────────────────────────────────────────────────────────────

/**
 * The fixed categories, first match wins. Each is matched against the rule
 * slug, the title and the user impact together: a slug alone ("discover-
 * status-hidden") rarely says what kind of problem it is.
 * Mirrored verbatim in packages/server/supabase/functions/_shared/audit-taxonomy.ts.
 * @internal Exported for the parity test only.
 */
export const AUDIT_TAXONOMY: ReadonlyArray<{ category: string; re: RegExp }> = [
  { category: 'a11y-loading-silent', re: /(loading|loads|skeleton|busy|streaming|placeholder|wait)[\s\S]{0,80}(screen reader|silent|announc|unlabel|accessible name|no status|status|no text|hears)|(screen reader|silent|announc|unlabel|no status|hears)[\s\S]{0,80}(loading|loads|skeleton|busy|streaming)/i },
  { category: 'offline-state', re: /offline|reconnect/i },
  { category: 'error-state', re: /(fail|error|rejected|timed? ?out|retry|try again)[\s\S]{0,80}(empty|blank|zero|no |nothing|hidden|vanish|disappear|silent|ready|looks|shown as|says|as if|ignored|swallow|generic|never|recover)|error-(shown|as)|silent-(error|failure|download)|no-retry|error-no|retry-/i },
  { category: 'loading-state', re: /(loading|loads|skeleton|spinner|suspense|redirect|placeholder)[\s\S]{0,80}(blank|empty|never|stuck|no |shows|looks|mismatch|vanish|disappear|columns|tiles)|blank-(redirect|loading|page)|false-empty|stuck-loading|lazy-without-suspense|blank page/i },
  { category: 'untranslated', re: /untranslated|(stays?|always|stuck|shows?|uses?|is|in)( an| the)? (in )?english|english[- ](error|text|copy|labels?|status|abbreviation|notice|data|in|member)|hardcoded-english|wrong language|in the wrong lang|i18n|translation key|raw key|hardcoded|locale|stays japanese|always adds thai|mixed-language|missing-lang|aria-lang/i },
  { category: 'contrast', re: /contrast|faint|washed out|blends? into|fades? (out|into)|hard to read|disappears on|on (a )?(cream|pale|white)|white-on|-on-(wash|fill|accent|error)/i },
  { category: 'overflow', re: /overflow|clip|cut off|cut-off|runs? (off|out|past)|spills|truncat|ellipsiz|too narrow|offscreen|off-screen/i },
  { category: 'control-hard-to-use', re: /tap[- ]target|hit[- ]target|too (small|thin|short) to tap|tiny[- ](tap|hit|target|dont|close|button|link|checkbox)|\d+px[- ](tall|target)|not focusable|keyboard|focus|hover[- ]only|until hover|steal clicks|zooms? the page/i },
  { category: 'control-does-nothing', re: /does nothing|do nothing|noop|no-op|dead-|ignored|never keeps|swallowed|no (tap )?feedback|gives no|no result|nothing happens/i },
  { category: 'a11y-name', re: /screen reader|accessible name|unlabel|unnamed|aria|alt text|heading level|announced (twice|as)|not announced|live region|silent to/i },
  { category: 'hydration-shift', re: /hydration|pops in|pop in|flicker|shifts?|jumps|flash/i },
  { category: 'reduced-motion', re: /reduced[- ]motion|keeps? (bobbing|floating|moving)|never stops moving/i },
  { category: 'wrong-number', re: /count|plural|\b0\b|zero|percent|%|total|mismatch|disagree|number|\$0|infinity|over-?count|under-?count|1 words/i },
  { category: 'date-time', re: /utc|date|time ?zone|day|week|month|year|hours|minute/i },
  { category: 'stale-state', re: /stale|previous|old |keeps the|stays|comes back|left over/i },
]

/** @internal Exported for the parity test only. */
export const AUDIT_CATEGORIES: readonly string[] = [...AUDIT_TAXONOMY.map((t) => t.category), 'other']

/** The fixed category of a finding, from its rule, title and user impact; `other` when nothing matches. */
export function auditCategory(f: { rule?: string | null; title?: string | null; userImpact?: string | null }): string {
  const text = `${(f.rule ?? '').replace(/-/g, ' ')} ${(f.rule ?? '')}\n${f.title ?? ''}\n${f.userImpact ?? ''}`
  for (const t of AUDIT_TAXONOMY) if (t.re.test(text)) return t.category
  return 'other'
}

/**
 * The pattern key: category + root. An `other` finding keeps its rule in the
 * key, so two unrelated problems in one file stay two reports.
 */
export function auditPatternKey(category: string, root: string, rule: string): string {
  const cat = AUDIT_CATEGORIES.includes(category) ? category : 'other'
  return (cat === 'other' ? `other:${rule}:${root}` : `${cat}:${root}`).slice(0, 400)
}

// ── Imports and the root component ─────────────────────────────────────────

/** @internal Exported for tests only. Local imports of a module: binding name → specifier. Package imports are left out by resolveImport. */
export function parseImports(source: string): Map<string, string> {
  const out = new Map<string, string>()
  const re = /import\s+(type\s+)?([\s\S]*?)\s+from\s+["']([^"']+)["']/g
  for (const m of source.matchAll(re)) {
    if (m[1]) continue
    const clause = m[2]!.trim()
    const spec = m[3]!
    const named = /\{([\s\S]*)\}/.exec(clause)
    const def = clause.replace(/\{[\s\S]*\}/, '').replace(/\*\s+as\s+\w+/, '').replace(/,/g, ' ').trim()
    if (def && /^[A-Za-z_$][\w$]*$/.test(def)) out.set(def, spec)
    if (named) {
      for (const part of named[1]!.split(',')) {
        const p = part.trim()
        if (!p || /^type\s/.test(p)) continue
        const [orig, alias] = p.split(/\s+as\s+/).map((x) => x.trim())
        const name = alias || orig
        if (name && /^[A-Za-z_$][\w$]*$/.test(name)) out.set(name, spec)
      }
    }
  }
  return out
}

const EXTS = ['.tsx', '.ts', '.jsx', '.js', '.vue', '.svelte']

/**
 * @internal Exported for tests only.
 * The repo path an import specifier names, or null for a package import or a
 * file that is not there. `@/` and `~/` are the repo root or `src/` (the two
 * layouts the audited apps use); `exists` says whether a repo path is a file.
 */
export function resolveImport(fromFile: string, spec: string, exists: (path: string) => boolean): string | null {
  let base: string[]
  if (spec.startsWith('./') || spec.startsWith('../')) base = [posix.normalize(posix.join(posix.dirname(fromFile), spec))]
  else if (spec.startsWith('@/') || spec.startsWith('~/')) base = [spec.slice(2), `src/${spec.slice(2)}`]
  else return null
  for (const b of base) {
    if (b.startsWith('..')) continue
    if (EXTS.some((e) => b.endsWith(e)) && exists(b)) return b
    for (const e of EXTS) if (exists(`${b}${e}`)) return `${b}${e}`
    for (const e of EXTS) if (exists(`${b}/index${e}`)) return `${b}/index${e}`
  }
  return null
}

/**
 * @internal Exported for tests only.
 * Where `name` is defined, following one barrel file (`export { X } from './x'`
 * or `export * from './x'`), so `@/design-system` resolves to the component.
 */
export function resolveComponent(fromFile: string, name: string, imports: Map<string, string>, read: (path: string) => string | null, exists: (path: string) => boolean): string | null {
  const spec = imports.get(name)
  if (!spec) return null
  const target = resolveImport(fromFile, spec, exists)
  if (!target) return null
  if (!/\/index\.[jt]sx?$/.test(target)) return target
  const barrel = read(target)
  if (barrel === null) return target
  const named = new RegExp(`export\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from\\s*["']([^"']+)["']`).exec(barrel)
  if (named) return resolveImport(target, named[1]!, exists) ?? target
  for (const m of barrel.matchAll(/export\s*\*\s*from\s*["']([^"']+)["']/g)) {
    const file = resolveImport(target, m[1]!, exists)
    const text = file ? read(file) : null
    if (file && text && new RegExp(`export\\s+(?:default\\s+)?(?:function|const|class)\\s+${name}\\b`).test(text)) return file
  }
  return target
}

/** @internal Exported for tests only. The component an evidence line opens (`<Skeleton …`), when it is an imported binding. */
export function evidenceTag(evidence: string): string | null {
  const m = /<([A-Z][\w]*)(?:\.[A-Z]\w*)?[\s/>]/.exec(`${evidence} `)
  return m ? m[1]! : null
}

/** Route files of one kind (Next.js / Expo Router): a fix to one of them is a fix to the shared kind. */
const CONVENTION_RE = /^(.*?\b(?:app|pages|routes))\/(?:.+\/)?(loading|error|not-found|global-error|\+not-found|_layout|layout)\.(tsx|jsx|ts|js)$/

/**
 * Where one fix for this finding would land:
 *  1. the shared component the evidence line renders (its own JSX tag, imported locally);
 *  2. every route file of the same kind, for a convention file (`app/** /loading.tsx`);
 *  3. the file itself.
 */
export function patternRoot(file: string, evidence: string, source: string | null, read: (path: string) => string | null, exists: (path: string) => boolean): string {
  const tag = evidenceTag(evidence)
  if (tag && source) {
    const imports = parseImports(source)
    const comp = resolveComponent(file, tag, imports, read, exists)
    if (comp && comp !== file) return comp
  }
  const conv = CONVENTION_RE.exec(file)
  if (conv) return `${conv[1]}/**/${conv[2]}.${conv[3]}`
  return file
}

/**
 * @internal Exported for tests only.
 * Imported components whose element encloses `line` (`<Shell>` above it,
 * `</Shell>` below it). A self-closing element encloses nothing.
 */
export function enclosingComponents(source: string, line: number): string[] {
  const lines = source.split('\n')
  const names = [...parseImports(source).keys()].filter((n) => /^[A-Z]/.test(n))
  const out: string[] = []
  for (const name of names) {
    const open = new RegExp(`<${name}(?=[\\s>])`)
    const close = new RegExp(`</${name}\\s*>`)
    let opened = false
    for (let n = 1; n < line && n <= lines.length; n++) if (open.test(lines[n - 1]!)) opened = true
    if (!opened) continue
    for (let n = line; n <= lines.length; n++) {
      if (close.test(lines[n - 1]!)) {
        out.push(name)
        break
      }
    }
  }
  return out
}

/**
 * An `absent` problem ("no aria-live near line 14") that a wrapper already
 * solves: one of the imported components enclosing the line has the pattern.
 * Returns the wrapper's path, or null when none holds it.
 */
export function absentHeldByWrapper(file: string, source: string, line: number | null, re: RegExp, read: (path: string) => string | null, exists: (path: string) => boolean): string | null {
  if (!line) return null
  const imports = parseImports(source)
  for (const name of enclosingComponents(source, line)) {
    const path = resolveComponent(file, name, imports, read, exists)
    const text = path ? read(path) : null
    if (path && text && text.split('\n').some((l) => re.test(l.slice(0, 1000)))) return path
  }
  return null
}
