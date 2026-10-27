/**
 * Two small frames for the onboarding docs path (quickstart, MCP, CLI loop,
 * incident loop):
 *
 * - <InThirtySeconds> — the page in three bullets, before any detail.
 * - <YouWillSee> — the end of a step: what should be on screen if it worked.
 *   The "You'll see:" lead-in is written in the MDX, so the mirrors keep it.
 *
 * Both take Markdown children, so their text stays in the llms-full.txt and
 * llm-md mirrors (scripts/lib/strip-markup.mjs drops only the tags).
 */
import type { ReactNode } from 'react'

export function InThirtySeconds({ children }: { children: ReactNode }) {
  return (
    <aside className="docs-tldr" aria-label="In 30 seconds">
      <p className="docs-tldr__title">In 30 seconds</p>
      <div className="docs-tldr__body">{children}</div>
    </aside>
  )
}

export function YouWillSee({ children }: { children: ReactNode }) {
  return (
    <div className="docs-check">
      <span className="docs-check__mark" aria-hidden="true">
        ✓
      </span>
      <div className="docs-check__body">{children}</div>
    </div>
  )
}
