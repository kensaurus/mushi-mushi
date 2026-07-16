/**
 * Shared width + grid rhythm for Settings tabs so panels align edge-to-edge.
 */

import type { ReactNode } from 'react'

interface SettingsPanelLayoutProps {
  children: ReactNode
  /** Full-width rows (ConnectionStatus, SDK install, etc.) */
  fullWidth?: ReactNode
  footer?: ReactNode
}

export function SettingsPanelLayout({ children, fullWidth, footer }: SettingsPanelLayoutProps) {
  return (
    <div className="space-y-4">
      {fullWidth}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-4 items-start">
        {children}
      </div>
      {footer}
    </div>
  )
}

/** Card shell matching Section chrome for BYOK-style blocks inside the grid. */
export function SettingsCard({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      // mushi-mushi-allowlist: hand-rolled surface (cn/template; not Card tile)
      className={`rounded-md border border-edge-subtle bg-surface-raised/40 p-3 space-y-2.5 ${className}`}
    >
      {children}
    </div>
  )
}
