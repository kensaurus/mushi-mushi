/**
 * Plain-language seat + billing FAQ for the Members page.
 */

import { Link } from 'react-router-dom'
import { IconAlertTriangle, IconInfo, IconUser } from '../icons'
import { seatBillingExplainer, type SeatBillingContext } from '../../lib/orgRoleGuide'
import { Callout } from '../ui/fields'
import { Btn } from '../ui'

interface Props extends SeatBillingContext {}

export function SeatBillingCallout(props: Props) {
  const { headline, body, billingLink, tone, calloutLabel } = seatBillingExplainer(props)

  const icon =
    tone === 'warn' ? (
      <IconAlertTriangle size={14} className="text-warn" />
    ) : tone === 'info' ? (
      <IconInfo size={14} className="text-info" />
    ) : (
      <IconUser size={14} />
    )

  return (
    <Callout
      tone={tone}
      label={calloutLabel}
      icon={icon}
      action={
        billingLink ? (
          <Link to="/billing" className="shrink-0">
            <Btn size="sm" variant="ghost">View billing</Btn>
          </Link>
        ) : undefined
      }
    >
      <p className="text-xs font-semibold text-fg">{headline}</p>
      <p className="mt-1 text-2xs leading-relaxed text-fg-muted">{body}</p>
    </Callout>
  )
}
