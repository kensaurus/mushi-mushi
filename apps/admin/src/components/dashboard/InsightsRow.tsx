/**
 * FILE: apps/admin/src/components/dashboard/InsightsRow.tsx
 * PURPOSE: Three-card insight strip — top components, integration health,
 *          and recent activity. Each card links into the deeper page.
 */

import { Link } from 'react-router-dom'
import { Card } from '../ui'
import { HealthPill } from '../charts'
import { useStaggeredAppear } from '../../lib/useStaggeredAppear'
import { relTime, type ActivityItem, type IntegrationStatus } from './types'

interface Props {
  topComponents: Array<{ component: string; count: number }>
  integrations: IntegrationStatus[]
  activity: ActivityItem[]
}

export function InsightsRow({ topComponents, integrations, activity }: Props) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-4">
      <TopComponentsCard topComponents={topComponents} />
      <IntegrationsCard integrations={integrations} />
      <ActivityCard activity={activity} />
    </div>
  )
}

function TopComponentsCard({ topComponents }: { topComponents: Props['topComponents'] }) {
  // `?? 1` only catches null/undefined — a `count` of 0 (which the server
  // can legitimately emit on an empty project) would set max=0 and produce
  // NaN-width bars. Match the `Math.max(1, …)` guard used in QuotaBanner.
  const max = Math.max(1, topComponents[0]?.count ?? 1)
  return (
    <Card className="p-3">
      <div className="flex items-center justify-between mb-2.5">
        <h3 className="text-xs font-medium text-fg-muted uppercase tracking-wider">Top components</h3>
        <Link to="/graph" className="text-2xs text-brand hover:text-brand-hover">Graph →</Link>
      </div>
      {topComponents.length === 0 ? (
        <p className="text-2xs text-fg-faint">No component data yet.</p>
      ) : (
        <div className="space-y-1.5">
          {topComponents.map(({ component, count }) => {
            const pct = (count / max) * 100
            return (
              <Link
                key={component}
                to={`/reports?component=${encodeURIComponent(component)}`}
                className="block group"
              >
                <div className="flex items-center justify-between text-2xs mb-0.5">
                  <span className="text-fg-secondary group-hover:text-fg truncate" title={component}>
                    {component}
                  </span>
                  <span className="font-mono text-fg-muted shrink-0 ml-2">{count}</span>
                </div>
                <div className="h-1 bg-surface-overlay rounded-sm overflow-hidden">
                  <div
                    className="h-full bg-brand/60 group-hover:bg-brand transition-colors"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </Card>
  )
}

function IntegrationsCard({ integrations }: { integrations: IntegrationStatus[] }) {
  return (
    <Card className="p-3">
      <div className="flex items-center justify-between mb-2.5">
        <h3 className="text-xs font-medium text-fg-muted uppercase tracking-wider">Integrations</h3>
        <Link to="/integrations" className="text-2xs text-brand hover:text-brand-hover">Manage →</Link>
      </div>
      {integrations.length === 0 ? (
        <p className="text-2xs text-fg-faint">Configure Sentry, Langfuse, GitHub on the Integrations page.</p>
      ) : (
        <div className="space-y-2">
          {integrations.map((it) => (
            <Link
              key={it.kind}
              to="/integrations"
              className="flex items-center justify-between gap-2 hover:bg-surface-overlay/50 rounded-sm px-1.5 py-1 transition-colors"
            >
              <span className="text-xs text-fg-secondary capitalize">{it.kind}</span>
              <div className="flex items-center gap-2">
                {it.uptime != null && (
                  <span className="text-3xs font-mono text-fg-muted">{(it.uptime * 100).toFixed(0)}% up</span>
                )}
                <HealthPill status={it.lastStatus} />
              </div>
            </Link>
          ))}
        </div>
      )}
    </Card>
  )
}

function ActivityCard({ activity }: { activity: ActivityItem[] }) {
  const stagger = useStaggeredAppear({ stepMs: 30, max: 8 })
  return (
    <Card className="p-3">
      <div className="flex items-center justify-between mb-2.5">
        <h3 className="text-xs font-medium text-fg-muted uppercase tracking-wider">Recent activity</h3>
      </div>
      {activity.length === 0 ? (
        <p className="text-2xs text-fg-faint">Nothing in the last 14 days.</p>
      ) : (
        <div className="space-y-1">
          {activity.map((a, i) => (
            <Link
              key={`${a.kind}-${a.id}-${i}`}
              to={a.kind === 'fix' ? '/fixes' : `/reports/${a.id}`}
              style={stagger(i)}
              className="flex items-center gap-2 py-1 px-1.5 rounded-sm hover:bg-surface-overlay/50 transition-colors group motion-safe:animate-mushi-fade-in"
            >
              <span
                className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${
                  a.kind === 'fix' ? 'bg-brand' : 'bg-info'
                }`}
              />
              <span className="text-2xs text-fg-secondary group-hover:text-fg flex-1 truncate">{a.label}</span>
              <span className="text-3xs font-mono text-fg-faint shrink-0">{relTime(a.at)}</span>
            </Link>
          ))}
        </div>
      )}
    </Card>
  )
}
