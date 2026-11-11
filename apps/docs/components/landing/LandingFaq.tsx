/**
 * Landing FAQ — visible accordion + schema.org FAQPage emitted from the same
 * LANDING_FAQ array, so the markup and the structured data can never drift.
 *
 * The questions are shown in two groups, "No coding" first (ADR 0056: the
 * no-code founder is the same buyer). Grouping is display only: the FAQPage
 * JSON-LD is one flat list of every question, in the order shown.
 */
'use client'

import { useId, useState } from 'react'
import Link from 'next/link'
import { LANDING_FAQ, LANDING_FAQ_GROUPS, type LandingFaqItem } from '@/lib/landing-copy'
import { JsonLd } from '../JsonLd'

interface Props {
  items?: readonly LandingFaqItem[]
}

/** Every item, in the order the groups are shown. */
function faqInShownOrder(items: readonly LandingFaqItem[]): LandingFaqItem[] {
  return LANDING_FAQ_GROUPS.flatMap((g) => items.filter((item) => item.group === g.id))
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
  const shown = faqInShownOrder(items)
  const [open, setOpen] = useState<string | null>(shown[0]?.q ?? null)
  const baseId = useId()

  return (
    <section aria-labelledby="landing-faq-heading">
      <JsonLd data={faqJsonLd(shown)} />
      <h2 id="landing-faq-heading">Frequently asked questions</h2>
      {LANDING_FAQ_GROUPS.map((group) => {
        const groupItems = shown.filter((item) => item.group === group.id)
        if (groupItems.length === 0) return null
        return (
          <div key={group.id} className="not-prose mt-5">
            <h3 className="m-0 text-sm font-semibold uppercase tracking-wide text-mushi-ink-muted">{group.label}</h3>
            <div className="mt-2 border border-mushi-rule rounded-md divide-y divide-mushi-rule">
              {groupItems.map((item) => {
                const i = shown.indexOf(item)
                const panelId = `${baseId}-panel-${i}`
                const isOpen = open === item.q
                return (
                  <div key={item.q}>
                    <button
                      type="button"
                      id={`${baseId}-trigger-${i}`}
                      className="w-full text-left px-4 py-3 text-sm font-medium text-mushi-ink hover:bg-mushi-paper-wash focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-mushi-vermillion"
                      aria-expanded={isOpen}
                      aria-controls={panelId}
                      onClick={() => setOpen(isOpen ? null : item.q)}
                    >
                      {item.q}
                    </button>
                    <div
                      id={panelId}
                      role="region"
                      aria-labelledby={`${baseId}-trigger-${i}`}
                      hidden={!isOpen}
                      inert={!isOpen}
                      className="px-4 pb-3 text-sm text-mushi-ink-muted"
                    >
                      <p className="m-0">{item.a}</p>
                      {item.more ? (
                        <p className="m-0 mt-2">
                          <Link href={item.more.href} className="font-medium text-mushi-vermillion hover:underline">
                            {item.more.label}
                          </Link>
                        </p>
                      ) : null}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </section>
  )
}
