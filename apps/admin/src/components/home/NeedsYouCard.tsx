/**
 * FILE: apps/admin/src/components/home/NeedsYouCard.tsx
 * PURPOSE: The few things on this app that need the owner, most costly
 *          first: one sentence and one button each, at most five. Counts
 *          come from the page each button opens (the /pipeline groups, the
 *          open-report filters), so the click shows the same number.
 *
 *          Above them, "Fix these first": at most three root causes from the
 *          Health check (plan-simplicity-2026-10 Phase 1), each once, with how
 *          many items wait on it and its one fix. The pipeline rows a root
 *          cause explains are left out of the list below by the server.
 */

import { Btn, Section, Skeleton } from '../ui'
import type { FixFirstItem, HomeSection, NeedsYouItem } from '../../lib/projectHome'
import { HomeSectionBody } from './HomeSectionBody'

const NEEDS_YOU_LIMIT = 5

interface Props {
  section: HomeSection<NeedsYouItem[]>
  /** Root causes from the Health check, shown first (absent on older servers). */
  fixFirst?: HomeSection<FixFirstItem[]>
  /** Items the console adds itself (an open setup step), placed first. */
  leading?: NeedsYouItem[]
  /** Reads the list could not use; it may be missing an item. */
  partial?: string[]
}

function waitingLine(n: number | null): string | null {
  if (n === null || n <= 0) return null
  return n === 1 ? '1 item is waiting on this.' : `${n} items are waiting on this.`
}

/** One root cause: what is wrong, how much waits on it, and its one fix. */
function FixFirstRow({ item }: { item: FixFirstItem }) {
  const fix = item.fix
  const waiting = waitingLine(item.affects)
  return (
    <li className="py-2 first:pt-0 last:pb-0" data-testid={`home-fix-first-${item.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-fg">{item.title}</p>
          <p className="text-xs text-fg-secondary">{item.detail}</p>
          {waiting && <p className="text-xs font-medium text-fg">{waiting}</p>}
        </div>
        {fix?.kind === 'one_click' && (
          <Btn size="sm" variant="primary" to={fix.to}>
            {fix.label}
          </Btn>
        )}
        {fix?.kind === 'guided' && fix.to && (
          <Btn size="sm" variant="ghost" to={fix.to}>
            {fix.label}
          </Btn>
        )}
      </div>
      {fix?.kind === 'guided' && fix.steps.length > 0 && (
        <ol className="mt-1 list-decimal pl-5 text-xs text-fg-secondary">
          {fix.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      )}
      {fix?.kind === 'auto' && <p className="mt-1 text-xs text-fg-secondary">Mushi Mushi fixes this on its own.</p>}
    </li>
  )
}

function FixFirst({ section }: { section: HomeSection<FixFirstItem[]> | undefined }) {
  const items = section?.status === 'ok' ? (section.data ?? []) : []
  if (items.length === 0) return null
  return (
    <div className="mb-3 rounded-md border border-edge-subtle p-2" data-testid="home-fix-first">
      <p className="mb-1 text-2xs font-semibold uppercase tracking-wide text-fg-secondary">Fix these first</p>
      <ol className="divide-y divide-edge-subtle">
        {items.slice(0, 3).map((item) => (
          <FixFirstRow key={item.key} item={item} />
        ))}
      </ol>
    </div>
  )
}

export function NeedsYouCard({ section, fixFirst, leading = [], partial = [] }: Props) {
  const hasRootCauses = fixFirst?.status === 'ok' && (fixFirst.data ?? []).length > 0
  return (
    <Section title="Needs you" id="home-needs-you">
      <FixFirst section={fixFirst} />
      <HomeSectionBody section={section} what="what needs you" notConnectedText="Nothing to check yet.">
        {(items) => {
          const all = [...leading, ...items].slice(0, NEEDS_YOU_LIMIT)
          return (
            <>
              {all.length === 0 ? (
                <p className="text-sm text-fg-secondary" data-testid="home-needs-you-clear">
                  {hasRootCauses ? 'Nothing else needs you right now.' : 'Nothing needs you right now. Mushi will list it here when something does.'}
                </p>
              ) : (
                <ol className="divide-y divide-edge-subtle" data-testid="home-needs-you">
                  {all.map((item, i) => (
                    <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-2 first:pt-0 last:pb-0" data-testid={`home-needs-you-${item.id}`}>
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
