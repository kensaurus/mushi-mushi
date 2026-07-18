/**
 * FILE: apps/admin/src/components/dashboard/TeamActivityTile.tsx
 * PURPOSE: Dashboard "who did what" tile — surfaces recent audit events with
 *          per-actor attribution (team member / agent / system) so operators
 *          can see, at a glance, which teammate created data or ran an action
 *          without opening the full Audit console. Reuses the existing
 *          GET /v1/admin/audit endpoint (project-scoped via ProjectSwitcher),
 *          so no backend change is needed. Rows deep-link into the Audit log
 *          pre-filtered by that actor.
 */

import { Link } from 'react-router-dom'
import { Card, PanelHeader } from '../ui'
import { ActionPill, SignalChip } from '../report-detail/ReportSurface'
import { EmptySectionMessage } from '../report-detail/ReportClassification'
import { relTime } from './types'
import { usePageData } from '../../lib/usePageData'
import { useRealtimeReload } from '../../lib/realtime'

/** Minimal shape of an audit row — matches AuditPage's AuditEntry / GET /v1/admin/audit. */
interface AuditEntry {
  id: string
  actor_id: string | null
  actor_email: string | null
  action: string
  resource_type: string
  resource_id: string | null
  created_at: string
}

interface AuditResponse {
  logs: AuditEntry[]
  count: number
}

type ActorKind = 'human' | 'agent' | 'system'

/**
 * Classify the actor for a small tone glyph. Mirrors the audit stat-mix
 * convention: email/uuid → human, `agent_*` ids → agent, null actor → system.
 */
function actorKind(e: AuditEntry): ActorKind {
  if (e.actor_email) return 'human'
  if (!e.actor_id) return 'system'
  if (e.actor_id.startsWith('agent_')) return 'agent'
  return 'agent'
}

function actorLabel(e: AuditEntry): string {
  return e.actor_email ?? e.actor_id ?? 'system'
}

const KIND_TONE: Record<ActorKind, 'info' | 'neutral'> = {
  human: 'info',
  agent: 'neutral',
  system: 'neutral',
}

const KIND_LABEL: Record<ActorKind, string> = {
  human: 'Member',
  agent: 'Agent',
  system: 'System',
}

interface Props {
  projectId: string | null
}

const RECENT_LIMIT = 8

export function TeamActivityTile({ projectId }: Props) {
  const { data, loading, reload } = usePageData<AuditResponse>(
    projectId ? `/v1/admin/audit?limit=${RECENT_LIMIT}` : null,
    { deps: [projectId] },
  )
  useRealtimeReload(['audit_logs'], reload)

  const logs = data?.logs ?? []

  return (
    <Card className="min-w-0 p-3">
      <PanelHeader
        title="Team activity"
        action={
          <ActionPill to="/audit" tone="brand">
            Audit log →
          </ActionPill>
        }
      />
      {loading && logs.length === 0 ? (
        <div className="space-y-1.5" aria-hidden>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-8 rounded-md bg-surface-overlay/25 motion-safe:animate-pulse" />
          ))}
        </div>
      ) : logs.length === 0 ? (
        <EmptySectionMessage
          text="No team activity yet."
          hint="Member and agent actions (report triage, fixes, settings changes) appear here as they happen."
        />
      ) : (
        <ul className="space-y-1.5">
          {logs.map((e) => {
            const kind = actorKind(e)
            const who = actorLabel(e)
            return (
              <li key={e.id}>
                <Link
                  to={`/audit?actor=${encodeURIComponent(who)}`}
                  className="group block rounded-md border border-edge-subtle/70 bg-surface-overlay/25 px-2 py-1.5 motion-safe:transition-opacity hover:border-edge hover:bg-surface-overlay/45"
                >
                  <div className="flex items-center gap-2">
                    <SignalChip tone={KIND_TONE[kind]}>{KIND_LABEL[kind]}</SignalChip>
                    <span className="min-w-0 shrink truncate text-xs font-medium text-fg group-hover:text-fg">
                      {who}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-mono text-2xs text-fg-secondary">
                      {e.action}
                    </span>
                    <SignalChip tone="neutral">{relTime(e.created_at)}</SignalChip>
                  </div>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}
