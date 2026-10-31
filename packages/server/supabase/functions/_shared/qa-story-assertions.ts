/**
 * FILE: packages/server/supabase/functions/_shared/qa-story-assertions.ts
 * PURPOSE: Decide whether a QA story's scraped text passed.
 *
 * runFirecrawl used to run assertContains only when Firecrawl returned
 * non-empty markdown, so a blank page, a blocked render, or a crash was
 * stored as passed. Stories can also list mustNotContain so a page that
 * shows "NaN", "undefined", or a raw translation key fails.
 *
 * mustNotContain matches a whole token (case-insensitive). "NaN" catches
 * "事業年度 NaN" and does not match the letters inside "finance".
 */

export interface QaAssertionFailure {
  step: string
  expected: string | null
  actual: string | null
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const terms: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const term = item.trim()
    if (term.length > 0) terms.push(term)
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
      contains: stringList(spec.assertContains),
      mustNotContain: stringList(spec.mustNotContain),
    }
  } catch {
    return { contains: [], mustNotContain: [] }
  }
}

/**
 * Case-insensitive token match. A boundary is the start or end of the text,
 * or a character other than an ASCII letter, digit, or "_". Japanese text
 * sits on those boundaries, so "事業年度 NaN" matches "NaN".
 */
function tokenPresent(haystack: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:^|[^A-Za-z0-9_])${escaped}(?![A-Za-z0-9_])`, 'i').test(haystack)
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
 * "(not found in HTML)").
 *
 * An empty scrape fails when the story has any text assertion. Quoted strings
 * in the prompt count as assertContains, except when the script already lists
 * mustNotContain — those quotes are usually the forbidden text itself.
 * A scrape with no text assertions stays a pass when the body is empty.
 */
export function qaContentFailures(
  story: { script: string | null; prompt: string | null },
  content: string,
  missingActual = '(not found)',
): QaAssertionFailure[] {
  const spec = readTextSpec(story.script)
  const mustNotContain = spec.mustNotContain
  const contains = spec.contains.length > 0
    ? spec.contains
    : mustNotContain.length > 0
      ? []
      : quotedPromptTerms(story.prompt)

  if (!content.trim()) {
    if (contains.length === 0 && mustNotContain.length === 0) return []
    return [{
      step: 'content',
      expected: emptyExpected(contains, mustNotContain),
      actual: '(empty scrape)',
    }]
  }

  const failures: QaAssertionFailure[] = []
  const haystack = content.toLowerCase()
  for (const term of contains) {
    if (!haystack.includes(term.toLowerCase())) {
      failures.push({ step: 'content', expected: term, actual: missingActual })
    }
  }
  for (const term of mustNotContain) {
    if (tokenPresent(content, term)) {
      failures.push({
        step: 'content',
        expected: `must not contain "${term}"`,
        actual: '(found)',
      })
    }
  }
  return failures
}
