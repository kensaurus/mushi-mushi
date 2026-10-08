/**
 * FILE: apps/admin/src/components/voice/VoiceSessionsList.tsx
 * PURPOSE: Recent voice intakes for the active project (plan C7 "activity
 *          card: last 20 intakes, status, PR link") — status chip, verbatim
 *          transcript excerpt, report / fix / PR links, and inline Confirm / Cancel
 *          for sessions still waiting on the gate.
 */

import { Link } from 'react-router-dom'
import { Badge, Btn, EmptyState, RelativeTime, Section } from '../ui'
import { fixesForReportPath } from '../../lib/fixDeepLink'
import { ActionPill, ActionPillRow } from '../report-detail/ReportSurface'
import { IconExternalLink, IconMic } from '../icons'
import {
  canConfirmVoiceSession,
  effectiveVoiceStatus,
  voiceActionLabel,
  voiceStatusLabel,
  voiceStatusTone,
  type VoiceSession,
} from '../../lib/voiceIntake'

interface VoiceSessionsListProps {
  sessions: VoiceSession[]
  onConfirm: (session: VoiceSession) => void
  onCancel: (session: VoiceSession) => void
  /** Session id currently being confirmed / cancelled. */
  pendingId: string | null
  /** False while the project has voice intake off: the recorder is disabled. */
  intakeEnabled: boolean
}

function excerpt(text: string | null | undefined, max = 160): string {
  if (!text) return ''
  const t = text.trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

export function VoiceSessionsList({ sessions, onConfirm, onCancel, pendingId, intakeEnabled }: VoiceSessionsListProps) {
  return (
    <Section title="Recent voice requests" icon={<IconMic className="h-4 w-4" />}>
      {sessions.length === 0 ? (
        <EmptyState
          title="No voice requests yet"
          description={
            intakeEnabled
              ? "Tap to talk above, share a voice memo into the app, or send a voice note to the project's Telegram bot."
              : 'Turn on voice intake first. Then tap to talk, share a voice memo into the app, or send a voice note to the Telegram bot.'
          }
          hints={['The first transcript shows up here with a Confirm button', 'Draft PRs link back from this list once the agent finishes']}
        />
      ) : (
        <ul className="divide-y divide-edge-subtle" data-testid="voice-sessions">
          {sessions.map((s) => {
            const status = effectiveVoiceStatus(s)
            const awaiting = canConfirmVoiceSession(s)
            const busy = pendingId === s.id
            return (
              <li key={s.id} className="py-2.5 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={voiceStatusTone(status)}>{voiceStatusLabel(status)}</Badge>
                  {s.source && <Badge tone="neutral">{s.source}</Badge>}
                  <span className="text-2xs text-fg-muted">{voiceActionLabel(s.action)}</span>
                  {s.created_at && (
                    <span className="ml-auto text-2xs text-fg-faint">
                      <RelativeTime value={s.created_at} />
                    </span>
                  )}
                </div>
                {s.summary && <p className="mt-1 text-xs text-fg">{s.summary}</p>}
                {s.transcript && (
                  <p className="mt-0.5 text-2xs text-fg-muted" title={s.transcript}>
                    “{excerpt(s.transcript)}”
                  </p>
                )}
                {s.message && !s.summary && <p className="mt-1 text-2xs text-fg-secondary">{s.message}</p>}
                {status === 'expired' && s.status === 'awaiting_confirm' && (
                  <p className="mt-1 text-xs text-fg-secondary">
                    The 10 minutes to confirm have passed and nothing was sent to an agent. Send the request again.
                  </p>
                )}
                {status === 'awaiting_confirm' && !awaiting && (
                  <p className="mt-1 text-xs text-fg-secondary">
                    You can&rsquo;t confirm this request from here. Ask someone with edit access to this project, or send it again.
                  </p>
                )}
                <ActionPillRow className="mt-1.5">
                  {awaiting && (
                    <>
                      <Btn variant="success" size="sm" onClick={() => onConfirm(s)} loading={busy} disabled={busy} title="Dispatch exactly what the transcript says">
                        Confirm
                      </Btn>
                      <Btn variant="cancel" size="sm" onClick={() => onCancel(s)} disabled={busy} title="Discard this request">
                        Cancel
                      </Btn>
                    </>
                  )}
                  {s.report_id && (
                    <Link
                      to={`/reports/${s.report_id}`}
                      className="inline-flex items-center gap-1 rounded-full border border-edge px-2.5 py-0.5 text-2xs font-medium text-fg-secondary hover:text-fg"
                    >
                      Report
                    </Link>
                  )}
                  {s.report_id && s.dispatch_id && (
                    <Link
                      to={fixesForReportPath(s.report_id)}
                      className="inline-flex items-center gap-1 rounded-full border border-edge px-2.5 py-0.5 text-2xs font-medium text-fg-secondary hover:text-fg"
                    >
                      See fix attempt
                    </Link>
                  )}
                  {s.pr_url && (
                    <ActionPill tone="ok" href={s.pr_url}>
                      Draft PR <IconExternalLink className="h-3 w-3" />
                    </ActionPill>
                  )}
                </ActionPillRow>
              </li>
            )
          })}
        </ul>
      )}
    </Section>
  )
}
