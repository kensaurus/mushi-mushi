/**
 * FILE: packages/server/supabase/functions/_shared/audit-taxonomy.ts
 * PURPOSE: The fixed category of a code-audit finding and its pattern key
 *          (ADR 0063). A copy of the table in packages/cli/src/worker/audit-patterns.ts:
 *          the worker computes the root (it has the clone), the server the
 *          category and the key (it files the report). audit-taxonomy-parity.test.ts
 *          keeps the two equal.
 *
 * No env reads and no imports: the Deno CI test runs without permissions.
 */

/**
 * The fixed categories, first match wins. Each is matched against the rule
 * slug, the title and the user impact together: a slug alone ("discover-
 * status-hidden") rarely says what kind of problem it is.
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
