/**
 * FILE: apps/admin/src/components/HelpRichText.tsx
 * PURPOSE: Renders help body copy inside PageHelp sections.
 *
 * HelpRichText — renders a string. Paragraphs separated by \n\n become <p>
 * elements. Inline `backtick` is wrapped in <code>. Bold **text** is <strong>.
 * No markdown parser dependency — keeps the bundle small.
 *
 * HelpBulletList — renders a <ul> of short strings.
 */

import React from 'react'

function parseInline(text: string): React.ReactNode[] {
  // Split on backtick spans and **bold** spans
  const parts: React.ReactNode[] = []
  const re = /(`[^`]+`|\*\*[^*]+\*\*)/g
  let last = 0
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index))
    const raw = match[0]
    if (raw.startsWith('`')) {
      parts.push(
        React.createElement(
          'code',
          {
            key: match.index,
            className:
              'rounded bg-surface-overlay/50 px-1 py-px font-mono text-3xs text-fg-secondary',
          },
          raw.slice(1, -1),
        ),
      )
    } else {
      parts.push(
        React.createElement(
          'strong',
          { key: match.index, className: 'font-semibold text-fg' },
          raw.slice(2, -2),
        ),
      )
    }
    last = match.index + raw.length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}

export function HelpRichText({ text }: { text: string }): React.ReactElement {
  const paragraphs = text.split(/\n\n+/).filter(Boolean)
  return React.createElement(
    React.Fragment,
    null,
    ...paragraphs.map((para, i) =>
      React.createElement(
        'p',
        {
          key: i,
          className:
            i === 0
              ? 'text-xs leading-relaxed text-fg-secondary'
              : 'mt-1.5 text-xs leading-relaxed text-fg-secondary',
        },
        ...parseInline(para),
      ),
    ),
  )
}

export function HelpBulletList({ items }: { items: readonly string[] }): React.ReactElement {
  return React.createElement(
    'ul',
    { className: 'space-y-1' },
    ...items.map((item, i) =>
      React.createElement(
        'li',
        { key: i, className: 'flex items-start gap-1.5 text-xs leading-relaxed text-fg-secondary' },
        React.createElement(
          'span',
          { className: 'mt-1 h-1 w-1 shrink-0 rounded-full bg-fg-muted', 'aria-hidden': true },
        ),
        React.createElement('span', null, ...parseInline(item)),
      ),
    ),
  )
}
