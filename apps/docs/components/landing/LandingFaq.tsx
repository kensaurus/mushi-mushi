/**
 * Landing FAQ — visible accordion + schema.org FAQPage emitted from the same
 * LANDING_FAQ array, so the markup and the structured data can never drift.
 */
'use client'

import { useId, useState } from 'react'
import { LANDING_FAQ, type LandingFaqItem } from '@/lib/landing-copy'
import { JsonLd } from '../JsonLd'

interface Props {
  items?: readonly LandingFaqItem[]
}

function faqJsonLd(items: readonly LandingFaqItem[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.q,
      acceptedAnswer: { '@type': 'Answer', text: item.a },
    })),
  }
}

export function LandingFaq({ items = LANDING_FAQ }: Props) {
  const [open, setOpen] = useState<number | null>(0)
  const baseId = useId()

  return (
    <section aria-labelledby="landing-faq-heading">
      <JsonLd data={faqJsonLd(items)} />
      <h2 id="landing-faq-heading">Frequently asked questions</h2>
      <div className="not-prose border border-mushi-rule rounded-md divide-y divide-mushi-rule">
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
    </section>
  )
}
