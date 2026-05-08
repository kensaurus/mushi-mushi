/**
 * FILE: apps/admin/src/components/marketplace/InstalledList.tsx
 * PURPOSE: List of installed plugins with full lifecycle controls — send test,
 *          pause, edit URL, rotate secret, and uninstall — delegating to
 *          InstalledPluginRow for per-row state.
 */

import { EmptyState } from '../ui'
import { InstalledPluginRow, type InstalledPluginRowProps } from './InstalledPluginRow'
import type { InstalledPlugin } from './types'

interface Props {
  installed: InstalledPlugin[]
  busySlug: string | null
  onTest: InstalledPluginRowProps['onTest']
  onTogglePause: InstalledPluginRowProps['onTogglePause']
  onEditUrl: InstalledPluginRowProps['onEditUrl']
  onRotateSecret: InstalledPluginRowProps['onRotateSecret']
  onUninstall: InstalledPluginRowProps['onUninstall']
}

export function InstalledList({
  installed,
  busySlug,
  onTest,
  onTogglePause,
  onEditUrl,
  onRotateSecret,
  onUninstall,
}: Props) {
  if (installed.length === 0) {
    return (
      <EmptyState
        title="No plugins installed"
        description="Install one above to start receiving signed webhooks."
      />
    )
  }
  return (
    <div className="space-y-2">
      {installed.map((p) => (
        <InstalledPluginRow
          key={p.plugin_slug ?? p.plugin_name}
          plugin={p}
          busy={busySlug === (p.plugin_slug ?? p.plugin_name)}
          onTest={onTest}
          onTogglePause={onTogglePause}
          onEditUrl={onEditUrl}
          onRotateSecret={onRotateSecret}
          onUninstall={onUninstall}
        />
      ))}
    </div>
  )
}
