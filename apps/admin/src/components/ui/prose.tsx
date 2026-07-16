/**
 * FILE: apps/admin/src/components/ui/prose.tsx
 * PURPOSE: Unified prose primitive — plain paragraphs, markdown bodies, excerpts.
 */

import { useMemo } from 'react'
import { Streamdown } from 'streamdown'
import { LongFormText } from './fields'
import {
  STREAMDOWN_LINK_SAFETY,
  streamdownUrlTransform,
} from '../../lib/streamdownSafety'

export type ProseBlockMode = 'plain' | 'markdown' | 'excerpt' | 'auto'

export interface ProseBlockProps {
  value: string
  /** `auto` picks markdown when lightweight heuristics match user/LLM copy. */
  mode?: ProseBlockMode
  className?: string
  tone?: 'fg' | 'muted'
  maxWidth?: string
  /** Max chars for `excerpt` mode (defaults to 380). */
  excerptMax?: number
}

const MD_SIGNAL = /(^|\n)\s{0,3}(#{1,6}\s|[-*+]\s|\d+\.\s|>\s)|\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\[[^\]]+\]\([^)]+\)/

export function looksLikeMarkdown(text: string): boolean {
  const t = text.trim()
  if (!t) return false
  return MD_SIGNAL.test(t)
}

/** First paragraph of markdown-ish copy, headings stripped, length-capped. */
export function excerptFirstParagraph(
  md: string | null | undefined,
  max = 380,
): string {
  if (!md) return ''
  const trimmed = md.trim()
  const split = trimmed.split(/\n\s*\n/, 2)
  const first = (split[0] ?? trimmed).replace(/^#+\s*/gm, '').trim()
  if (!first) return ''
  return first.length > max ? `${first.slice(0, max)}…` : first
}

function resolveMode(value: string, mode: ProseBlockMode): 'plain' | 'markdown' | 'excerpt' {
  if (mode === 'auto') return looksLikeMarkdown(value) ? 'markdown' : 'plain'
  return mode
}

/**
 * Canonical renderer for paragraph-length copy across Intelligence digests,
 * report bodies, and drawer previews. Prefer this over ad-hoc `firstParagraph`
 * helpers or raw Streamdown at call sites.
 */
export function ProseBlock({
  value,
  mode = 'plain',
  className = '',
  tone = 'fg',
  maxWidth = 'max-w-prose',
  excerptMax = 380,
}: ProseBlockProps) {
  const resolved = resolveMode(value, mode)
  const excerpt = useMemo(
    () => (resolved === 'excerpt' ? excerptFirstParagraph(value, excerptMax) : value),
    [resolved, value, excerptMax],
  )

  if (!value.trim()) {
    return (
      <p className={`text-sm text-fg-muted italic ${maxWidth} ${className}`}>
        No content provided.
      </p>
    )
  }

  if (resolved === 'markdown') {
    return (
      <div className={`${maxWidth} min-w-0 ${className}`}>
        <Streamdown
          className="prose-mushi"
          linkSafety={STREAMDOWN_LINK_SAFETY}
          urlTransform={streamdownUrlTransform}
        >
          {value}
        </Streamdown>
      </div>
    )
  }

  return (
    <LongFormText
      value={excerpt}
      tone={tone}
      maxWidth={maxWidth}
      className={className}
    />
  )
}
