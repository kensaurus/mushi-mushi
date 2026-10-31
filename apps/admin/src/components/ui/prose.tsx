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

type ProseBlockMode = 'plain' | 'markdown' | 'excerpt' | 'auto'

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

/** @internal Exported for tests only. */
export function looksLikeMarkdown(text: string): boolean {
  const t = text.trim()
  if (!t) return false
  return MD_SIGNAL.test(t)
}

/**
 * First paragraph of markdown-ish copy that says something, headings
 * stripped, length-capped. A paragraph that is only a heading is skipped:
 * Weekly insights' summary card showed just "Mushi Mushi Weekly Bug Digest",
 * the digest's title (2026-10-28). All headings: the first one.
 * @internal Exported for tests only.
 */
export function excerptFirstParagraph(
  md: string | null | undefined,
  max = 380,
): string {
  if (!md) return ''
  const paragraphs = md.trim().split(/\n\s*\n/).filter((p) => p.trim())
  const isHeading = (p: string) => p.trim().split('\n').every((line) => /^\s{0,3}#{1,6}\s/.test(line))
  // "**Project:** x | **Week of:** y": a label line, not something to read.
  const isLabelLine = (p: string) => !p.trim().includes('\n') && /^\*\*[^*]+:\*\*/.test(p.trim())
  const pick = paragraphs.find((p) => !isHeading(p) && !isLabelLine(p)) ?? paragraphs[0] ?? ''
  // Plain text: the excerpt renders as-is, so bold markers would show as "**".
  const first = pick.replace(/^#+\s*/gm, '').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/__([^_]+)__/g, '$1').trim()
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
