/**
 * FILE: apps/admin/src/components/marketplace/InstalledList.tsx
 * PURPOSE: Compact list of currently-installed plugins with last-delivery
 *          status pill. Read-only — uninstall happens from the catalog card.
 */

import { Badge, Card, EmptyState } from '../ui'
import { STATUS_CHIP, type InstalledPlugin } from './types'

interface Props {
  installed: InstalledPlugin[]
}

export function InstalledList({ installed }: Props) {
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
        <Card
          key={p.plugin_slug ?? p.plugin_name}
          className="p-3 flex items-center justify-between gap-2 flex-wrap"
        >
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-xs font-semibold">{p.plugin_name}</p>
              {!p.is_active && <Badge className="bg-fg-muted/10 text-fg-muted">disabled</Badge>}
            </div>
            <p className="text-2xs text-fg-muted font-mono wrap-anywhere">
              {p.webhook_url ?? '(built-in)'}
            </p>
            <div className="flex flex-wrap gap-1 mt-1">
              {p.subscribed_events.length === 0 ? (
                <code className="text-3xs bg-surface-raised px-1.5 py-0.5 rounded">all events</code>
              ) : (
                p.subscribed_events.map((e) => (
                  <code key={e} className="text-3xs bg-surface-raised px-1.5 py-0.5 rounded">
                    {e}
                  </code>
                ))
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {p.last_delivery_status ? (
              <span
                className={`inline-flex rounded px-2 py-0.5 text-3xs ${STATUS_CHIP[p.last_delivery_status]}`}
              >
                {p.last_delivery_status.toUpperCase()}
              </span>
            ) : null}
            {p.last_delivery_at ? (
              <span className="text-2xs text-fg-muted">
                {new Date(p.last_delivery_at).toLocaleString()}
              </span>
            ) : null}
          </div>
        </Card>
      ))}
    </div>
  )
}
