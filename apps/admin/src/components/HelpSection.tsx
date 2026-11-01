/**
 * FILE: apps/admin/src/components/HelpSection.tsx
 * PURPOSE: Section wrapper used inside PageHelp to group related help
 *          content with a small neutral left rail.
 *
 * `tone` names the section's role (info / tip / steps / nav) for callers;
 * all tones render the same neutral rail — see TONE_RAIL below.
 */

import React from 'react'
import type { ReactNode } from 'react'
import { PAGE_HELP_SECTION_SHELL } from '../lib/pageHelpSurfaces'

type HelpTone = 'info' | 'tip' | 'steps' | 'nav'

// One neutral rail and AA title colour for every tone. Four hues on four help
// sections (blue / amber / vermillion / grey) read as four different status
// levels, and raw `text-warn` titles were ~2.3:1 on white. The section titles
// ("What it is", "When to use it", …) already carry the distinction.
const TONE_RAIL: Record<HelpTone, string> = {
  info:  'bg-edge',
  tip:   'bg-edge',
  steps: 'bg-edge',
  nav:   'bg-edge',
}

const TONE_TITLE: Record<HelpTone, string> = {
  info:  'text-fg-secondary',
  tip:   'text-fg-secondary',
  steps: 'text-fg-secondary',
  nav:   'text-fg-secondary',
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
    { className: `${PAGE_HELP_SECTION_SHELL} flex gap-2.5 ${className}` },
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
