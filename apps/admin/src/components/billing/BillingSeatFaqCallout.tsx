/**
 * Seat + teammate pricing FAQ on the Billing page — mirrors Members callout.
 */

import { Link } from 'react-router-dom'
import { SeatBillingCallout } from '../members/SeatBillingCallout'
import { seatBillingExplainer, type SeatBillingContext } from '../../lib/orgRoleGuide'
import { FeatureExplainPanel } from '../FeatureExplainPanel'

interface Props extends SeatBillingContext {
  /** Wrap in collapsible panel on Plans tab where space is tight. */
  collapsible?: boolean
}

export function BillingSeatFaqCallout({ collapsible = false, ...ctx }: Props) {
  if (!collapsible) {
    return <SeatBillingCallout {...ctx} />
  }

  const { headline, body } = seatBillingExplainer(ctx)

  return (
    <FeatureExplainPanel
      title="Do teammates cost extra?"
      summary="Seat limits depend on your plan — role choice is about permissions, not price per role."
      category="billing"
      defaultOpen={ctx.teamsEnabled && ctx.seatLimit !== null && ctx.seatsUsed >= (ctx.seatLimit ?? 0) - 1}
    >
      <p className="text-xs font-semibold text-fg">{headline}</p>
      <p className="text-2xs leading-relaxed text-fg-muted">{body}</p>
      <p className="text-2xs text-fg-faint">
        Manage invites and roles on{' '}
        <Link to="/organization/members" className="text-accent-foreground hover:text-accent underline underline-offset-2 motion-safe:transition-opacity">
          Members
        </Link>
        .
      </p>
    </FeatureExplainPanel>
  )
}
