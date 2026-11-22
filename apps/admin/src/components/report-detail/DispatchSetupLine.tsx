/**
 * FILE: apps/admin/src/components/report-detail/DispatchSetupLine.tsx
 * PURPOSE: The visible reason under a disabled "Dispatch fix": each step left
 *          as a link to where it is done, and how many are done
 *          ("To dispatch a fix: Connect GitHub · Index your code · Turn on
 *          Autofix (1 of 4 done)"). Model: lib/dispatchSetupSteps.
 *
 *          A disabled button with only a tooltip said nothing on touch and
 *          nothing to someone who never hovered (feedback 2026-11-22).
 */

import { Fragment } from 'react'
import { Link, useInRouterContext } from 'react-router-dom'
import type { DispatchSetupSteps } from '../../lib/dispatchSetupSteps'

interface Props {
  setup: DispatchSetupSteps
  /** Referenced by the disabled button's aria-describedby. */
  id?: string
  lead?: string
  className?: string
  'data-testid'?: string
}

const LINK_CLASS = 'font-medium text-accent-foreground underline underline-offset-2 hover:text-accent'

export function DispatchSetupLine({ setup, id, lead = 'To dispatch a fix:', className = '', 'data-testid': testId = 'dispatch-setup-line' }: Props) {
  const inRouter = useInRouterContext()
  return (
    <p id={id} className={`text-2xs leading-snug text-fg-muted ${className}`} data-testid={testId}>
      <span>{lead}</span>{' '}
      {setup.steps.map((step, i) => (
        <Fragment key={step.key}>
          {i > 0 ? <span aria-hidden="true"> · </span> : null}
          {step.href.startsWith('http') || !inRouter ? (
            <a
              href={step.href}
              target={step.href.startsWith('http') ? '_blank' : undefined}
              rel={step.href.startsWith('http') ? 'noopener noreferrer' : undefined}
              className={LINK_CLASS}
            >
              {step.label}
            </a>
          ) : (
            <Link to={step.href} className={LINK_CLASS}>
              {step.label}
            </Link>
          )}
          {i < setup.steps.length - 1 ? <span className="sr-only">,</span> : null}
        </Fragment>
      ))}{' '}
      <span className="whitespace-nowrap">
        ({setup.done} of {setup.total} done)
      </span>
    </p>
  )
}
