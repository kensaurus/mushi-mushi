/**
 * FILE: packages/server/supabase/functions/_shared/qa-story-assertions.ts
 * PURPOSE: Decide whether a QA story's scraped text passed.
 *
 * OVERVIEW:
 * - `runFirecrawl` used to run text checks only when Firecrawl returned
 *   non-empty markdown, so a blank page, a blocked render, or a crash was
 *   stored as passed.
 * - Stories can list `mustNotContain` so a page that shows "NaN",
 *   "undefined", or a raw translation key fails.
 * - `runDirectFetch` uses the same rules against the raw HTML body.
 *
 * DEPENDENCIES:
 * - None. The runners pass the story script and the scraped text.
 *
 * USAGE:
 * - `qaContentFailures(story, content, missingActual)` from
 *   `qa-story-runner`.
 *
 * TECHNICAL DETAILS:
 * - Required text is `assertContains`, or quoted strings in the prompt
 *   when `assertContains` is absent. A `mustNotContain` list does not
 *   drop those quotes; a quote is skipped only when it is the same
 *   forbidden term (case-insensitive).
 * - Both lists match as case-insensitive substrings, same as the old
 *   `assertContains` check. "categories.economy" fails inside
 *   "categories.economy_label".
 * - Blank entries are ignored. A non-blank entry is matched as written,
 *   including surrounding spaces.
 * - An empty or whitespace-only body fails when any text assertion is
 *   set. A story with none still passes, so a screenshot-only run is
 *   unchanged.
 *
 * NOTES:
 * - Whole-token matching for `mustNotContain` was rejected: it let a
 *   forbidden string through when it was embedded in a longer token.
 */

export interface QaAssertionFailure {
  step: string
  expected: string | null
  actual: string | null
}

/** Keep non-blank strings as written. Trim is only the blank check. */
function nonBlankStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const terms: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    if (item.trim().length === 0) continue
    terms.push(item)
  }
  return terms
}

/** Quoted phrases in the prompt, same extraction the runner used inline. */
function quotedPromptTerms(prompt: string | null): string[] {
  if (!prompt) return []
  return [...prompt.matchAll(/["']([^"']{2,50})["']/g)].map((match) => match[1]).slice(0, 8)
}

function readTextSpec(script: string | null): { contains: string[]; mustNotContain: string[] } {
  if (!script || script.startsWith('http')) return { contains: [], mustNotContain: [] }
  try {
    const parsed = JSON.parse(script) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { contains: [], mustNotContain: [] }
    }
    const spec = parsed as { assertContains?: unknown; mustNotContain?: unknown }
    return {
      contains: nonBlankStrings(spec.assertContains),
      mustNotContain: nonBlankStrings(spec.mustNotContain),
    }
  } catch {
    return { contains: [], mustNotContain: [] }
  }
}

function sameTerm(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}

/**
 * Explicit assertContains wins. Otherwise use prompt quotes, minus a quote
 * that is itself a forbidden term (the prompt often names the string the
 * page must not show).
 */
function requiredTerms(contains: string[], mustNotContain: string[], prompt: string | null): string[] {
  if (contains.length > 0) return contains
  return quotedPromptTerms(prompt).filter((term) => !mustNotContain.some((forbidden) => sameTerm(term, forbidden)))
}

function hasTerm(haystack: string, term: string): boolean {
  return haystack.toLowerCase().includes(term.toLowerCase())
}

function emptyExpected(contains: string[], mustNotContain: string[]): string {
  const parts: string[] = []
  if (contains.length > 0) parts.push(contains.join(', '))
  if (mustNotContain.length > 0) {
    parts.push(mustNotContain.map((term) => `must not contain "${term}"`).join(', '))
  }
  return parts.join('; ')
}

/**
 * Failures for one scrape. `missingActual` is the "got" text when a required
 * phrase is absent (Firecrawl says "(not found)", directFetch says
 * "(not found in HTML)"). An empty body uses "(empty scrape)" instead.
 */
export function qaContentFailures(
  story: { script: string | null; prompt: string | null },
  content: string,
  missingActual = '(not found)',
): QaAssertionFailure[] {
  const spec = readTextSpec(story.script)
  const mustNotContain = spec.mustNotContain
  const contains = requiredTerms(spec.contains, mustNotContain, story.prompt)

  if (!content.trim()) {
    if (contains.length === 0 && mustNotContain.length === 0) return []
    return [{
      step: 'content',
      expected: emptyExpected(contains, mustNotContain),
      actual: '(empty scrape)',
    }]
  }

  const failures: QaAssertionFailure[] = []
  for (const term of contains) {
    if (!hasTerm(content, term)) {
      failures.push({ step: 'content', expected: term, actual: missingActual })
    }
  }
  for (const term of mustNotContain) {
    if (hasTerm(content, term)) {
      failures.push({
        step: 'content',
        expected: `must not contain "${term}"`,
        actual: '(found)',
      })
    }
  }
  return failures
}
