/**
 * FILE: apps/admin/src/components/marketplace/InstalledHealthList.tsx
 * PURPOSE: The top of Plugins (console journeys 2026-10-27): the plugins
 *          you installed, each with a state dot, when it last delivered and
 *          its last 7 days, failing ones first. The catalogue sits below it;
 *          the full controls stay on the Installed tab.
 */

import { Link } from 'react-router-dom'
import { Card } from '../ui'
import { relativeTime } from '../../lib/setupGuideSteps'
import { pluginHealth, type InstalledPlugin, type PluginHealthTone, type ReliabilityStats } from './types'

interface Props {
  installed: InstalledPlugin[]
  reliabilityBySlug: Map<string, ReliabilityStats>
}

const DOT: Record<PluginHealthTone, string> = {
  ok: 'bg-ok',
  warn: 'bg-warn',
  danger: 'bg-danger',
  neutral: 'bg-fg-faint',
}

const RANK: Record<PluginHealthTone, number> = { danger: 0, warn: 1, neutral: 2, ok: 3 }

function weekLine(stats: ReliabilityStats | undefined): string {
  if (!stats || stats.total === 0) return 'No deliveries in the last 7 days'
  const failed = stats.error > 0 ? ` · ${stats.error} failed` : ''
  return `${stats.total} sent in 7 days${failed}`
}

export function InstalledHealthList({ installed, reliabilityBySlug }: Props) {
  const rows = installed
    .map((p) => {
      const stats = p.plugin_slug ? reliabilityBySlug.get(p.plugin_slug) : undefined
      return { plugin: p, stats, health: pluginHealth(p, stats) }
    })
    .sort((a, b) => RANK[a.health.tone] - RANK[b.health.tone])

  return (
    <Card className="p-0">
      <ul aria-label="Your plugins" className="divide-y divide-edge-subtle">
        {rows.map(({ plugin, stats, health }) => (
          <li key={plugin.id ?? plugin.plugin_slug ?? plugin.plugin_name} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5">
            <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${DOT[health.tone]}`} />
            <div className="min-w-0 flex-1 basis-48">
              <p className="truncate text-sm font-medium text-fg">{plugin.plugin_name}</p>
              <p className="text-2xs text-fg-muted">
                <span className={health.tone === 'danger' ? 'text-danger' : health.tone === 'warn' ? 'text-warn' : undefined}>{health.label}</span>
                {plugin.last_delivery_at ? ` · last sent ${relativeTime(plugin.last_delivery_at)}` : ''}
              </p>
            </div>
            <p className="shrink-0 text-2xs text-fg-secondary tabular-nums">{weekLine(stats)}</p>
            <Link
              to="/marketplace?tab=installed"
              className="shrink-0 text-2xs text-accent-foreground underline underline-offset-2 hover:text-accent"
            >
              Manage
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  )
}
