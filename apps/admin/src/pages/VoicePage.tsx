/**
 * FILE: apps/admin/src/pages/VoicePage.tsx
 * PURPOSE: Phone-first voice intake (plan docs/execplans/dead-code-voice-agent-loop.md,
 *          C1 "PWA" adapter + C5 push + C7 activity card). Tap-to-talk or
 *          upload a clip → signed upload → POST /v1/intake/voice → verbatim
 *          transcript + proposed action → Confirm / Cancel gate → the draft
 *          PR comes back to this phone as a push. Also the landing route for
 *          the manifest share_target (`?shared=1`) and the PWA start_url.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { PAGE_CONTENT_STACK } from '../lib/pageLayout'
import { usePageData } from '../lib/usePageData'
import { usePublishPageContext } from '../lib/pageContext'
import { useRealtimeReload } from '../lib/realtime'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { useSetupStatus } from '../lib/useSetupStatus'
import { useToast } from '../lib/toast'
import { takeSharedAudio } from '../lib/pwa'
import {
  VOICE_SESSIONS_PATH,
  cancelVoiceSession,
  confirmVoiceSession,
  submitVoiceTranscript,
  uploadAndSubmitVoice,
  voiceActionLabel,
  voiceStatusLabel,
  voiceStatusTone,
  type VoiceSession,
} from '../lib/voiceIntake'
import { Badge, Btn, Card, ErrorAlert, FreshnessPill, Section } from '../components/ui'
import { ContainedBlock, SignalChip } from '../components/report-detail/ReportSurface'
import { PageHeaderBar } from '../components/PageHeaderBar'
import { PagePosture, POSTURE_PRIORITY } from '../components/PagePosture'
import { SetupNudge } from '../components/SetupNudge'
import { PanelSkeleton } from '../components/skeletons/PanelSkeleton'
import { IconMic } from '../components/icons'
import { VoiceRecorderCard, type SubmitStage } from '../components/voice/VoiceRecorderCard'
import { VoiceSessionsList } from '../components/voice/VoiceSessionsList'
import { PushNotifyCard } from '../components/voice/PushNotifyCard'

const HELP = {
  title: 'About voice intake',
  whatIsIt:
    'Talk a bug or a fix request into your phone. Mushi transcribes it server-side, shows you the exact words and the action it inferred, and only after you confirm does it create the report and send an agent to open a draft PR — never merged automatically.',
  useCases: [
    'Dictate a bug you just hit on your phone without typing a ticket',
    'Ask for a small fix from the couch and get the draft PR link pushed back',
    'Share a voice memo from Google Recorder straight into the console (Android)',
  ],
  howToUse:
    'Tap to talk (max 2 minutes), or upload a clip. Read the transcript, then Confirm or Cancel. Tap "Notify this device" once so the PR link comes back as a push. Turn the feature on under Settings → Voice intake first.',
}

interface VoiceProjectSettings {
  voice_intake_enabled?: boolean
  voice_languages?: string[]
}

export function VoicePage() {
  const toast = useToast()
  const activeProjectId = useActiveProjectId()
  const setup = useSetupStatus(activeProjectId)
  const projectName = setup.activeProject?.project_name ?? null
  const [searchParams, setSearchParams] = useSearchParams()

  const sessionsPath = activeProjectId ? VOICE_SESSIONS_PATH : null
  const {
    data: sessionsData,
    loading,
    error,
    reload,
    lastFetchedAt,
    isValidating,
  } = usePageData<{ sessions: VoiceSession[] }>(sessionsPath, { deps: [activeProjectId] })
  const { data: settings } = usePageData<VoiceProjectSettings>(activeProjectId ? '/v1/admin/settings' : null, {
    deps: [activeProjectId],
  }) // error-handled-by-parent
  useRealtimeReload(['voice_intake_sessions'], reload, { enabled: Boolean(activeProjectId) })

  const intakeEnabled = settings?.voice_intake_enabled !== false
  const settingsKnown = settings != null

  const [current, setCurrent] = useState<VoiceSession | null>(null)
  const [busyStage, setBusyStage] = useState<SubmitStage | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [sharedFile, setSharedFile] = useState<File | null>(null)
  const sharedHandled = useRef(false)

  const sessions = useMemo(() => sessionsData?.sessions ?? [], [sessionsData])
  const awaitingCount = sessions.filter((s) => s.status === 'awaiting_confirm').length

  usePublishPageContext({
    route: '/voice',
    title: 'Voice',
    summary: awaitingCount > 0 ? `${awaitingCount} awaiting confirmation` : undefined,
    filters: { project_id: activeProjectId ?? undefined },
    criticalCount: awaitingCount,
  })

  const submitFile = useCallback(
    async (file: File) => {
      if (busyStage) return
      setCurrent(null)
      const res = await uploadAndSubmitVoice(file, setBusyStage)
      setBusyStage(null)
      if (!res.ok) {
        toast.error(
          res.code === 'VOICE_INTAKE_DISABLED' ? 'Voice intake is off for this project' : 'Voice request failed',
          res.message,
        )
        return
      }
      setCurrent(res.session)
      reload()
    },
    [busyStage, reload, toast],
  )

  const submitText = useCallback(
    async (text: string) => {
      if (busyStage) return
      setCurrent(null)
      setBusyStage('transcribing')
      const res = await submitVoiceTranscript({ transcript: text, externalId: crypto.randomUUID() })
      setBusyStage(null)
      if (!res.ok || !res.data?.session) {
        toast.error('Request failed', res.error?.message ?? 'The server rejected the request')
        return
      }
      setCurrent(res.data.session)
      reload()
    },
    [busyStage, reload, toast],
  )

  // Web Share Target landing: the SW stashed the shared file; take it once.
  const shared = searchParams.get('shared')
  const sharedText = searchParams.get('text') ?? undefined
  useEffect(() => {
    if (shared !== '1' || sharedHandled.current) return
    sharedHandled.current = true
    void takeSharedAudio().then((file) => {
      const next = new URLSearchParams(searchParams)
      next.delete('shared')
      setSearchParams(next, { replace: true })
      if (!file) {
        toast.info('Nothing to send', 'The shared file was empty or already used.')
        return
      }
      setSharedFile(file)
      if (activeProjectId) void submitFile(file)
    })
  }, [shared, searchParams, setSearchParams, activeProjectId, submitFile, toast])

  async function confirm(session: VoiceSession) {
    if (!session.confirm_token) return
    setPendingId(session.id)
    const res = await confirmVoiceSession(session.id, session.confirm_token)
    setPendingId(null)
    if (!res.ok) {
      toast.error('Could not confirm', res.error?.message)
      return
    }
    const next = res.data?.session ?? { ...session, status: res.data?.status ?? 'confirmed', confirm_token: null, message: res.data?.message ?? null }
    if (current?.id === session.id) setCurrent(next)
    toast.success('Confirmed', res.data?.message ?? 'The agent is on it — you will get a push when the draft PR is up.')
    reload()
  }

  async function cancel(session: VoiceSession) {
    if (!session.confirm_token) return
    setPendingId(session.id)
    const res = await cancelVoiceSession(session.id, session.confirm_token)
    setPendingId(null)
    if (!res.ok) {
      toast.error('Could not cancel', res.error?.message)
      return
    }
    if (current?.id === session.id) setCurrent({ ...session, status: 'cancelled', confirm_token: null })
    toast.info('Cancelled', 'Nothing was dispatched.')
    reload()
  }

  if (!activeProjectId) {
    return (
      <div className={PAGE_CONTENT_STACK} data-testid="mushi-page-voice">
        <PageHeaderBar title="Voice" helpTitle={HELP.title} helpWhatIsIt={HELP.whatIsIt} helpUseCases={HELP.useCases} helpHowToUse={HELP.howToUse} />
        <SetupNudge requires={['project']} emptyTitle="Select a project" emptyDescription="Voice requests are scoped to the active project in the header." />
      </div>
    )
  }

  const statusBanner = settingsKnown && !intakeEnabled ? (
    <ContainedBlock tone="warn" label="Voice intake is off">
      <div className="flex flex-wrap items-center gap-2">
        <span>Recordings will be refused until the project turns it on.</span>
        <Link to="/settings?tab=voice" className="text-xs font-medium text-brand underline-offset-2 hover:underline">
          Open Settings → Voice intake
        </Link>
      </div>
    </ContainedBlock>
  ) : null

  return (
    <div className={PAGE_CONTENT_STACK} data-testid="mushi-page-voice">
      <PageHeaderBar
        title="Voice"
        icon={<IconMic className="h-4 w-4" />}
        projectScope={projectName ?? undefined}
        description="Talk a bug or a fix request; confirm the transcript; the draft PR comes back to this phone."
        helpTitle={HELP.title}
        helpWhatIsIt={HELP.whatIsIt}
        helpUseCases={HELP.useCases}
        helpHowToUse={HELP.howToUse}
      >
        {awaitingCount > 0 && <Badge tone="warn">{awaitingCount} to confirm</Badge>}
        <FreshnessPill at={lastFetchedAt} isValidating={isValidating} />
        <Btn size="sm" variant="ghost" onClick={reload} title="Reload voice requests">
          Refresh
        </Btn>
      </PageHeaderBar>

      <PagePosture slots={[{ id: 'intake-off', priority: POSTURE_PRIORITY.status, show: statusBanner != null, children: statusBanner }]} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5 items-start">
        <div className="space-y-4 min-w-0 lg:col-span-3">
          <VoiceRecorderCard
            onFile={(file) => void submitFile(file)}
            onTranscript={(text) => void submitText(text)}
            busyStage={busyStage}
            disabled={settingsKnown && !intakeEnabled}
            initialText={sharedText}
            pendingFile={sharedFile}
          />
          {current && <VoiceSessionResult session={current} pending={pendingId === current.id} onConfirm={() => void confirm(current)} onCancel={() => void cancel(current)} />}
        </div>
        <div className="min-w-0 lg:col-span-2">
          <PushNotifyCard />
        </div>
      </div>

      {loading ? (
        <PanelSkeleton rows={4} label="Loading voice requests" />
      ) : error ? (
        <ErrorAlert message={`Failed to load voice requests: ${error}`} onRetry={reload} />
      ) : (
        <VoiceSessionsList sessions={sessions} onConfirm={(s) => void confirm(s)} onCancel={(s) => void cancel(s)} pendingId={pendingId} onRefresh={reload} isValidating={isValidating} />
      )}
    </div>
  )
}

function VoiceSessionResult({ session, pending, onConfirm, onCancel }: { session: VoiceSession; pending: boolean; onConfirm: () => void; onCancel: () => void }) {
  const awaiting = session.status === 'awaiting_confirm' && Boolean(session.confirm_token)
  const refused = session.status === 'refused'
  return (
    <Section title="What Mushi heard" action={<Badge tone={voiceStatusTone(session.status)}>{voiceStatusLabel(session.status)}</Badge>}>
      <div className="space-y-3" data-testid="voice-session-result">
        <Card variant="flat" className="p-3">
          <p className="mb-1 text-2xs font-semibold uppercase tracking-wide text-fg-muted">Transcript (verbatim)</p>
          <p className="text-sm leading-relaxed text-fg whitespace-pre-wrap">{session.transcript?.trim() || '—'}</p>
        </Card>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <ContainedBlock tone="neutral" label="Action">
            {voiceActionLabel(session.action)}
          </ContainedBlock>
          <ContainedBlock tone="neutral" label="Summary">
            {session.summary?.trim() || '—'}
          </ContainedBlock>
        </div>
        {session.message && (
          <SignalChip tone={refused ? 'danger' : session.status === 'failed' ? 'danger' : 'info'} className="whitespace-normal">
            {session.message}
          </SignalChip>
        )}
        {awaiting && (
          <div className="flex flex-wrap items-center gap-2">
            <Btn variant="success" onClick={onConfirm} loading={pending} disabled={pending} title="Dispatch exactly what the transcript says">
              Confirm and dispatch
            </Btn>
            <Btn variant="cancel" onClick={onCancel} disabled={pending} title="Discard this request">
              Cancel
            </Btn>
            <span className="text-2xs text-fg-muted">The token expires in 10 minutes.</span>
          </div>
        )}
        {session.report_id && (
          <Link to={`/reports/${session.report_id}`} className="text-xs font-medium text-brand underline-offset-2 hover:underline">
            Open the report
          </Link>
        )}
        {session.pr_url && (
          <a href={session.pr_url} target="_blank" rel="noopener noreferrer" className="text-xs font-medium text-brand underline-offset-2 hover:underline">
            Open the draft PR
          </a>
        )}
      </div>
    </Section>
  )
}
