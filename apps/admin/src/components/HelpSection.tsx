/**
 * FILE: apps/admin/src/components/HelpSection.tsx
 * PURPOSE: Tonal section wrapper used inside PageHelp to group related
 *          help content with a small left-rail accent.
 *
 * Tones:
 *   info  — blue-tinted rail, default for "What it is"
 *   tip   — amber-tinted rail, for "When to use it"
 *   steps — brand-tinted rail, for "How to use it" (sequential steps)
 *   nav   — neutral rail, for "Related pages" (houses PageRelatedLinks)
 */

import React from 'react'
import type { ReactNode } from 'react'

type HelpTone = 'info' | 'tip' | 'steps' | 'nav'

const TONE_RAIL: Record<HelpTone, string> = {
  info:  'bg-info/50',
  tip:   'bg-warn/50',
  steps: 'bg-brand/50',
  nav:   'bg-fg-muted/30',
}

const TONE_TITLE: Record<HelpTone, string> = {
  info:  'text-info',
  tip:   'text-warn',
  steps: 'text-brand',
  nav:   'text-fg-muted',
}

interface HelpSectionProps {
  tone?: HelpTone
  title: string
  className?: string
  children: ReactNode
}

export function HelpSection({
  tone = 'info',
  title,
  className = '',
  children,
}: HelpSectionProps): React.ReactElement {
  return React.createElement(
    'div',
    { className: `flex gap-2.5 ${className}` },
    // Left accent rail
    React.createElement('div', {
      className: `mt-0.5 w-0.5 shrink-0 self-stretch rounded-full ${TONE_RAIL[tone]}`,
      'aria-hidden': true,
    }),
    React.createElement(
      'div',
      { className: 'min-w-0 flex-1' },
      React.createElement(
        'p',
        { className: `mb-1 text-3xs font-semibold uppercase tracking-wider ${TONE_TITLE[tone]}` },
        title,
      ),
      children,
    ),
  )
}
