/**
 * FILE: apps/admin/src/components/StatusBannerAction.tsx
 * PURPOSE: Consistent CTA for page status banners — primary for warn/danger
 *          (action required), ghost for informational states.
 */

import { Btn } from './ui'
import type { StatusBannerTone } from './StatusBannerShell'

interface StatusBannerActionProps {
  label: string
  to?: string
  onClick?: () => void
  tone?: StatusBannerTone
  emphasis?: 'auto' | 'primary' | 'ghost'
  loading?: boolean
  disabled?: boolean
}

export function StatusBannerAction({
  label,
  to,
  onClick,
  tone = 'info',
  emphasis = 'auto',
  loading,
  disabled,
}: StatusBannerActionProps) {
  const variant =
    emphasis === 'auto'
      ? tone === 'danger' || tone === 'warn'
        ? 'primary'
        : 'ghost'
      : emphasis

  return (
    <Btn size="sm" variant={variant} to={to} onClick={onClick} loading={loading} disabled={disabled}>
      {label}
    </Btn>
  )
}
