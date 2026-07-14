/**
 * FILE: apps/admin/src/components/dashboard/InsightsRow.tsx
 * PURPOSE: Three-card insight strip — top components, integration health,
 *          and recent activity. Each card links into the deeper page.
 */

import { Link } from 'react-router-dom'
import { Card, PanelHeader } from '../ui'
import { HealthPill } from '../charts'
import { useStaggeredAppear } from '../../lib/useStaggeredAppear'
import { relTime, type ActivityItem, type IntegrationStatus } from './types'
import { EmptySectionMessage } from '../report-detail/ReportClassification'

interface Props {
  topComponents: Array<{ component: string; count: number }>
  integrations: IntegrationStatus[]
  activity: ActivityItem[]
}

export function InsightsRow({ topComponents, integrations, activity }: Props) {
  return (
    <div className="mb-4 grid grid-cols-1 gap-3 lg:grid-cols-3">
      <TopComponentsCard topComponents={topComponents} />
      <IntegrationsCard integrations={integrations} />
      <ActivityCard activity={activity} />
    </div>
  )
}

function TopComponentsCard({ topComponents }: { topComponents: Props['topComponents'] }) {
  const max = Math.max(1, topComponents[0]?.count ?? 1)
  return (
    <Card className="min-w-0 p-3">
      <PanelHeader
        title="Top components"
        action={
          <Link to="/graph" className="shrink-0 text-2xs text-accent-foreground hover:text-accent">
            Graph →
          </Link>
        }
      />
      {topComponents.length === 0 ? (
        <EmptySectionMessage
          text="No component data yet."
          hint="Reports will populate this once classification runs."
        />
      ) : (
        <div className="space-y-2">
          {topComponents.map(({ component, count }) => {
            const pct = (count / max) * 100
            return (
              <Link
                key={component}
                to={`/reports?component=${encodeURIComponent(component)}`}
                className="group block"
              >
                <div className="mb-1 flex items-center justify-between gap-2 text-2xs">
                  <span
                    className="min-w-0 truncate text-fg-secondary group-hover:text-fg"
                    title={component}
                  >
                    {component}
                  </span>
                  <span className="shrink-0 font-mono text-fg-muted">{count}</span>
                </div>
                {/* P2 — h-1.5 (6px) so the bar is actually visible, not a hairline */}
                <div className="h-1.5 overflow-hidden rounded-full bg-surface-overlay">
                  <div
                    className="h-full rounded-full bg-brand/70 motion-safe:transition-[width,background-color] group-hover:bg-brand"
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

/** P3 — colour-code the uptime figure so "0% up" screams without the user
 *  reading it; "Unknown" gets a distinct muted treatment separate from "Healthy". */
function uptimeTone(uptime: number | null): string {
  if (uptime == null) return 'text-fg-faint'
  if (uptime >= 0.95) return 'text-ok'
  if (uptime >= 0.7) return 'text-warn'
  return 'text-danger'
}

function IntegrationsCard({ integrations }: { integrations: IntegrationStatus[] }) {
  return (
    <Card className="min-w-0 p-3">
      <PanelHeader
        title="Integrations"
        action={
          <Link to="/integrations/config" className="shrink-0 text-2xs text-accent-foreground hover:text-accent">
            Manage →
          </Link>
        }
      />
      {integrations.length === 0 ? (
        <EmptySectionMessage
          text="No integrations configured yet."
          hint="Configure Sentry, Langfuse, and GitHub on the Integrations page."
        />
      ) : (
        <div className="divide-y divide-edge-subtle/40">
          {integrations.map((it) => (
            <Link
              key={it.kind}
              to="/integrations/config"
              className="flex items-center justify-between gap-2 py-1.5 first:pt-0 last:pb-0 motion-safe:transition-colors hover:opacity-80"
            >
              <span className="text-xs capitalize text-fg-secondary">{it.kind}</span>
              <div className="flex items-center gap-2">
                {it.uptime != null && (
                  <span className={`font-mono text-3xs ${uptimeTone(it.uptime)}`}>
                    {(it.uptime * 100).toFixed(0)}% up
                  </span>
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
    <Card className="min-w-0 p-3">
      <PanelHeader title="Recent activity" />
      {activity.length === 0 ? (
        <EmptySectionMessage
          text="Nothing in the last 14 days."
          hint="Recent reports and fixes will appear here."
        />
      ) : (
        <div className="space-y-0.5">
          {activity.map((a, i) => (
            <Link
              key={`${a.kind}-${a.id}-${i}`}
              to={a.kind === 'fix' ? '/fixes' : `/reports/${a.id}`}
              style={stagger(i)}
              className="group flex items-center gap-2 rounded-sm px-1.5 py-1 motion-safe:animate-mushi-fade-in motion-safe:transition-colors hover:bg-surface-overlay/50"
            >
              {/* P4 — square for fix (deliberate action), circle for report (event) */}
              {a.kind === 'fix' ? (
                <span
                  className="inline-block h-1.5 w-1.5 shrink-0 rounded-micro bg-brand"
                  aria-label="fix"
                />
              ) : (
                <span
                  className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-danger/70"
                  aria-label="report"
                />
              )}
              <span className="min-w-0 flex-1 truncate text-2xs text-fg-secondary group-hover:text-fg">
                {a.label}
              </span>
              <span className="shrink-0 font-mono text-3xs text-fg-faint">{relTime(a.at)}</span>
            </Link>
          ))}
        </div>
      )}
    </Card>
  )
}
