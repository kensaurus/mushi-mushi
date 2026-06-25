/**
 * Langfuse-style "Not seeing what you expected?" FAQ block for quickstarts.
 */
'use client'

import { useId, useState } from 'react'
import { PUBLIC_FAQ, type PublicFaqItem } from '@/lib/public-copy'

interface Props {
  items?: readonly PublicFaqItem[]
}

export function TroubleshootingAccordion({ items = PUBLIC_FAQ }: Props) {
  const [open, setOpen] = useState<number | null>(null)
  const baseId = useId()

  return (
    <div className="not-prose border border-mushi-rule rounded-md divide-y divide-mushi-rule">
      <p className="px-4 py-3 m-0 font-semibold text-sm text-mushi-ink">Not seeing what you expected?</p>
      {items.map((item, i) => {
        const panelId = `${baseId}-panel-${i}`
        const isOpen = open === i
        return (
          <div key={item.q}>
            <button
              type="button"
              id={`${baseId}-trigger-${i}`}
              className="w-full text-left px-4 py-3 text-sm font-medium text-mushi-ink hover:bg-mushi-paper-wash focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-mushi-vermillion"
              aria-expanded={isOpen}
              aria-controls={panelId}
              onClick={() => setOpen(isOpen ? null : i)}
            >
              {item.q}
            </button>
            <p
              id={panelId}
              role="region"
              aria-labelledby={`${baseId}-trigger-${i}`}
              hidden={!isOpen}
              inert={!isOpen}
              className="px-4 pb-3 m-0 text-sm text-mushi-ink-muted"
            >
              {item.a}
            </p>
          </div>
        )
      })}
    </div>
  )
}
