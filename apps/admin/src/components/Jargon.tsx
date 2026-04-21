/**
 * FILE: apps/admin/src/components/Jargon.tsx
 * PURPOSE: Inline plain-language tooltip for unavoidable jargon nouns.
 *
 *  Wraps the term in an <abbr> with a dotted underline. In beginner mode,
 *  the JARGON registry is consulted and a tooltip-on-hover surfaces the
 *  plain-language definition. In advanced mode, the bare word is rendered
 *  with no decoration.
 *
 *  Use sparingly — outcome-first copy from `lib/copy.ts` is always
 *  preferable to wrapping a jargon noun.
 */

import type { ReactNode } from 'react'
import { useAdminMode } from '../lib/mode'
import { JARGON } from '../lib/copy'

interface JargonProps {
  /** The jargon term — must match a key in JARGON or pass `definition`. */
  term: string
  /** Override the rendered text (defaults to `term`). */
  children?: ReactNode
  /** Override the definition (defaults to JARGON[term]). */
  definition?: string
}

export function Jargon({ term, children, definition }: JargonProps) {
  const { isAdvanced } = useAdminMode()
  const def = definition ?? JARGON[term]
  // Show the dotted-underline + tooltip for both Quickstart and Beginner.
  // Advanced mode strips decoration so power users see the bare term.
  if (isAdvanced || !def) return <>{children ?? term}</>
  return (
    <abbr
      title={def}
      className="cursor-help underline decoration-dotted decoration-fg-faint underline-offset-2 hover:decoration-brand"
    >
      {children ?? term}
    </abbr>
  )
}
