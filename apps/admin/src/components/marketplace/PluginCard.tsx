/**
 * FILE: apps/admin/src/components/marketplace/PluginCard.tsx
 * PURPOSE: Catalog card for a single plugin — shows install state, reliability
 *          stats (computed by the page from the dispatch log), event chips,
 *          and an Install/Uninstall action that bubbles up.
 */

import { Btn, Card } from '../ui'
import {
  CATEGORY_LABEL,
  type InstalledPlugin,
  type MarketplacePlugin,
  type ReliabilityStats,
} from './types'

interface Props {
  plugin: MarketplacePlugin
  installed: InstalledPlugin | undefined
  stats: ReliabilityStats | undefined
  busy: boolean
  onInstall: () => void
  onUninstall: () => void
}

export function PluginCard({ plugin: p, installed: inst, stats, busy, onInstall, onUninstall }: Props) {
  return (
    <Card className="p-3 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">{p.name}</h3>
            {p.is_official ? (
              <span className="inline-flex rounded px-1.5 py-0.5 text-3xs bg-brand/10 text-brand">
                Official
              </span>
            ) : null}
          </div>
          <p className="text-2xs text-fg-muted">
            {p.publisher} · {CATEGORY_LABEL[p.category] ?? p.category}
            {p.install_count > 0 && ` · ${p.install_count.toLocaleString()} installs`}
          </p>
        </div>
        {inst ? (
          <span
            className={`inline-flex rounded px-2 py-0.5 text-3xs ${inst.is_active ? 'bg-emerald-500/10 text-emerald-500' : 'bg-fg-muted/10 text-fg-muted'}`}
          >
            {inst.is_active ? 'Installed' : 'Disabled'}
          </span>
        ) : null}
      </div>

      <p className="text-xs opacity-80">{p.short_description}</p>

      {p.manifest?.subscribes?.length ? (
        <div className="flex flex-wrap gap-1">
          {p.manifest.subscribes.slice(0, 4).map((evt) => (
            <code key={evt} className="text-3xs bg-surface-raised px-1.5 py-0.5 rounded">
              {evt}
            </code>
          ))}
          {p.manifest.subscribes.length > 4 && (
            <span className="text-3xs text-fg-faint">
              +{p.manifest.subscribes.length - 4} more
            </span>
          )}
        </div>
      ) : null}

      {inst && stats && (
        <div className="flex items-center gap-2 flex-wrap text-3xs text-fg-muted border-t border-edge-subtle pt-2">
          <span>
            <span className="font-mono text-fg">{stats.total}</span> deliveries
          </span>
          <span>
            <span className="font-mono text-ok">{stats.ok}</span> ok
          </span>
          {stats.error > 0 && (
            <span>
              <span className="font-mono text-danger">{stats.error}</span> failed
            </span>
          )}
          <span>
            avg <span className="font-mono">{stats.avgLatency}ms</span>
          </span>
          {inst.webhook_url && (
            <code
              className="ml-auto truncate max-w-[12rem] text-fg-faint"
              title={inst.webhook_url}
            >
              {inst.webhook_url.replace(/^https?:\/\//, '')}
            </code>
          )}
        </div>
      )}

      <div className="mt-auto flex items-center justify-between pt-2">
        {p.source_url ? (
          <a
            href={p.source_url}
            target="_blank"
            rel="noreferrer"
            className="text-2xs text-brand hover:underline"
          >
            Source ↗
          </a>
        ) : (
          <span />
        )}
        {inst ? (
          <Btn variant="ghost" size="sm" onClick={onUninstall} disabled={busy}>
            {busy ? 'Removing…' : 'Uninstall'}
          </Btn>
        ) : (
          <Btn size="sm" onClick={onInstall} disabled={busy}>
            Install
          </Btn>
        )}
      </div>
    </Card>
  )
}
