/**
 * FILE: packages/server/supabase/functions/_shared/css-scopes.ts
 * PURPOSE: Read CSS custom properties per selector scope (Plan 019 §1.2, §2).
 *          DTCG 2025.10 has no modes, so a light/dark mode expressed as a
 *          scoped selector (`html.dark:root[data-direction="x"]`) is read as
 *          its own scope. Counted scopes are `:root`, Tailwind v4 `@theme`, and
 *          any selector the manifest declares in `design.css[].scopes`.
 *          Custom properties found only under an undeclared selector are an
 *          `info` issue (`css_vars_in_undeclared_scope`), never silently dropped.
 *          Static text parsing only; no host code runs.
 */

import { parseCssColor, toHex } from './design-color.ts'
import type { RecipeIssue } from './recipe-types.ts'

export interface CssScope {
  selector: string
  kind: 'root' | 'theme' | 'declared'
  vars: Array<{ name: string; value: string; hex: string | null }>
}

export interface CssScopeResult {
  scopes: CssScope[]
  undeclared: Array<{ selector: string; count: number }>
  issues: RecipeIssue[]
}

const MAX_VARS_PER_SCOPE = 500

function normalizeSelector(sel: string): string {
  return sel.replace(/\s+/g, ' ').replace(/\s*([>,+~])\s*/g, '$1').replace(/'/g, '"').trim()
}

function classify(header: string, declared: ReadonlySet<string>): CssScope['kind'] | null {
  if (/^@theme\b/i.test(header)) return 'theme'
  if (header.startsWith('@')) return null
  const parts = header.split(',').map(normalizeSelector)
  if (parts.every((p) => p === ':root')) return 'root'
  if (parts.every((p) => p === ':root' || declared.has(p))) return 'declared'
  return null
}

/** Parse one CSS file. `declaredScopes` are the manifest's `css[].scopes` for it. */
export function parseCssScopes(path: string, text: string, declaredScopes: readonly string[]): CssScopeResult {
  const declared = new Set(declaredScopes.map(normalizeSelector))
  const css = text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  const byScope = new Map<string, CssScope>()
  const undeclared = new Map<string, number>()
  // Innermost blocks only: a rule nested in @media still has its own selector header.
  for (const m of css.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    const header = (m[1].split(';').pop() ?? '').trim()
    const vars = [...m[2].matchAll(/(--[A-Za-z0-9_-]+)\s*:\s*([^;]+)/g)].map((v) => {
      const value = v[2].trim()
      const c = parseCssColor(value)
      return { name: v[1], value: value.slice(0, 300), hex: c ? toHex(c) : null }
    })
    if (vars.length === 0) continue
    const kind = classify(header, declared)
    const key = /^@theme\b/i.test(header) ? '@theme' : header.split(',').map(normalizeSelector).join(', ')
    if (!kind) {
      undeclared.set(key, (undeclared.get(key) ?? 0) + vars.length)
      continue
    }
    const scope = byScope.get(key) ?? { selector: key, kind, vars: [] }
    for (const v of vars) {
      const at = scope.vars.findIndex((x) => x.name === v.name)
      if (at >= 0) scope.vars[at] = v
      else if (scope.vars.length < MAX_VARS_PER_SCOPE) scope.vars.push(v)
    }
    byScope.set(key, scope)
  }
  const issues: RecipeIssue[] = [...undeclared.entries()].map(([selector, count]) => ({
    severity: 'info',
    code: 'css_vars_in_undeclared_scope',
    message: `${count} custom propert${count === 1 ? 'y' : 'ies'} under "${selector}", which is not :root, @theme or a scope declared in design.css[].scopes; they are not read as tokens.`,
    file: path,
  }))
  for (const s of declaredScopes) {
    if (!byScope.has(normalizeSelector(s))) {
      issues.push({ severity: 'warn', code: 'css_scope_empty', message: `Declared scope "${s}" has no custom properties in this file.`, file: path })
    }
  }
  return { scopes: [...byScope.values()], undeclared: [...undeclared.entries()].map(([selector, count]) => ({ selector, count })), issues }
}
