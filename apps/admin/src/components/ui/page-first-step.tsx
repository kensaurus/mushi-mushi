/**
 * FILE: apps/admin/src/components/ui/page-first-step.tsx
 * PURPOSE: The one "do this first" card for an empty page (pattern P3,
 *          console journeys 2026-10-27). Experiments, Improvement runs,
 *          Schema changes, Unusual spikes and Research each opened on six
 *          tiles of 0 or "—"; an empty page now says what is missing in one
 *          sentence and offers one button, with an optional "learn more".
 *
 *          While the card is on screen the page counts as empty, so Layout
 *          shows the page's "How this page works" help expanded under it
 *          (lib/pageHelpContext). Once the page has data the help goes back
 *          to the header popover.
 *
 *          The action type allows exactly one of `to`, `href` or `onClick`.
 */

import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useMarkPageEmpty } from '../../lib/pageHelpContext'
import { Btn } from './forms'
import { Card } from './layout'

/** @public */
export type FirstStepAction =
  | { label: string; to: string; href?: never; onClick?: never; loading?: never; disabled?: boolean }
  | { label: string; href: string; to?: never; onClick?: never; loading?: never; disabled?: boolean }
  | { label: string; onClick: () => void; to?: never; href?: never; loading?: boolean; disabled?: boolean }

/** @public */
export type FirstStepLink =
  | { label?: string; to: string; href?: never }
  | { label?: string; href: string; to?: never }

export interface PageFirstStepProps {
  /** Short status: what is missing ("No experiments yet"). */
  title: string
  /** One sentence: why it matters and what the button does. */
  sentence: string
  action: FirstStepAction
  learnMore?: FirstStepLink
  /** Optional glyph left of the title. */
  icon?: ReactNode
  /** Set false when the card sits inside a page that has other data. */
  marksPageEmpty?: boolean
  'data-testid'?: string
}

export function PageFirstStep({
  title,
  sentence,
  action,
  learnMore,
  icon,
  marksPageEmpty = true,
  'data-testid': testId = 'page-first-step',
}: PageFirstStepProps) {
  useMarkPageEmpty(marksPageEmpty)
  return (
    <Card className="border-dashed p-4 sm:p-5" data-testid={testId}>
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          {icon ? (
            <span
              aria-hidden="true"
              className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-sm border border-brand/28 bg-brand/12 text-brand"
            >
              {icon}
            </span>
          ) : null}
          <div className="min-w-0">
            <h3 className="text-sm font-semibold leading-snug text-fg">{title}</h3>
            <p className="mt-1 max-w-prose text-xs leading-relaxed text-fg-muted text-pretty">{sentence}</p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2">
          <FirstStepButton action={action} />
          {learnMore ? <LearnMoreLink link={learnMore} /> : null}
        </div>
      </div>
    </Card>
  )
}

function FirstStepButton({ action }: { action: FirstStepAction }) {
  if (action.to !== undefined) {
    return (
      <Btn size="sm" variant="primary" to={action.to} disabled={action.disabled}>
        {action.label}
      </Btn>
    )
  }
  if (action.href !== undefined) {
    return (
      <Btn size="sm" variant="primary" href={action.href} disabled={action.disabled}>
        {action.label}
      </Btn>
    )
  }
  return (
    <Btn size="sm" variant="primary" onClick={action.onClick} loading={action.loading} disabled={action.disabled}>
      {action.label}
    </Btn>
  )
}

const LEARN_MORE_CLASS =
  'text-2xs font-medium text-accent-foreground underline-offset-2 hover:text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 rounded-sm'

function LearnMoreLink({ link }: { link: FirstStepLink }) {
  const label = link.label ?? 'Learn more'
  if (link.to !== undefined) {
    return (
      <Link to={link.to} className={LEARN_MORE_CLASS}>
        {label} →
      </Link>
    )
  }
  return (
    <a href={link.href} target="_blank" rel="noopener noreferrer" className={LEARN_MORE_CLASS}>
      {label} →
    </a>
  )
}
