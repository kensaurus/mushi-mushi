/**
 * FILE: apps/admin/src/components/home/NeedsYouCard.tsx
 * PURPOSE: The few things on this app that need the owner, most costly
 *          first: one sentence and one button each, at most five. Counts
 *          come from the page each button opens (the /pipeline groups, the
 *          open-report filters), so the click shows the same number.
 */

import { Btn, Section, Skeleton } from '../ui'
import type { HomeSection, NeedsYouItem } from '../../lib/projectHome'
import { HomeSectionBody } from './HomeSectionBody'

const NEEDS_YOU_LIMIT = 5

interface Props {
  section: HomeSection<NeedsYouItem[]>
  /** Items the console adds itself (an open setup step), placed first. */
  leading?: NeedsYouItem[]
  /** Reads the list could not use; it may be missing an item. */
  partial?: string[]
}

export function NeedsYouCard({ section, leading = [], partial = [] }: Props) {
  return (
    <Section title="Needs you" id="home-needs-you">
      <HomeSectionBody section={section} what="what needs you" notConnectedText="Nothing to check yet.">
        {(items) => {
          const all = [...leading, ...items].slice(0, NEEDS_YOU_LIMIT)
          return (
            <>
              {all.length === 0 ? (
                <p className="text-sm text-fg-secondary" data-testid="home-needs-you-clear">
                  Nothing needs you right now. Mushi will list it here when something does.
                </p>
              ) : (
                <ol className="divide-y divide-edge-subtle" data-testid="home-needs-you">
                  {all.map((item, i) => (
                    <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-2 first:pt-0 last:pb-0">
                      <p className="min-w-0 flex-1 text-sm text-fg">{item.text}</p>
                      {/* One primary action: the costliest item; the rest stay quiet. */}
                      <Btn size="sm" variant={i === 0 ? 'primary' : 'ghost'} to={item.action.to}>
                        {item.action.label}
                      </Btn>
                    </li>
                  ))}
                </ol>
              )}
              {partial.length > 0 && (
                <p className="mt-2 text-2xs text-fg-faint">Some checks could not be read just now, so this list may be missing an item.</p>
              )}
            </>
          )
        }}
      </HomeSectionBody>
    </Section>
  )
}

export function NeedsYouSkeleton() {
  return (
    <Section title="Needs you">
      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-6 w-full" />
        ))}
      </div>
    </Section>
  )
}
