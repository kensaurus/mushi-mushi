/**
 * FILE: apps/admin/src/components/settings/SelfHostSetupChecklist.tsx
 * PURPOSE: Settings → SDK & connection: a compact "Self-host setup" list, only
 *          when the server says it is self-hosted (GET /health `mode`). Each
 *          item has its mark, one line, and the button that fixes it when the
 *          console can (lib/selfHostChecklist.ts decides; this fetches).
 *          Problems first; a progress bar shows how far setup is.
 */

import { useEffect, useState } from 'react'
import { fetchServerInstance, type ServerInstance } from '../../lib/buildInfo'
import { RESOLVED_API_URL } from '../../lib/env'
import { usePageData } from '../../lib/usePageData'
import { DOCTOR_RUN_STATUS, type DoctorReport } from '../../lib/doctorView'
import { checklistProgress, selfHostChecklist, type ChecklistItem, type ChecklistStatus, type ReadyBody } from '../../lib/selfHostChecklist'
import { StatusMark, type RunStatus } from '../signal/StatusMark'
import { BarCell } from '../signal/BarCell'
import { Btn } from '../ui'
import { SettingsList } from './SettingsRow'

const SELF_HOST_DOCS = 'https://kensaur.us/mushi-mushi/docs/self-hosting'

const MARK: Record<ChecklistStatus, RunStatus> = { ...DOCTOR_RUN_STATUS, unknown: 'waiting' }
const RANK: Record<ChecklistStatus, number> = { fail: 0, warn: 1, unknown: 2, info: 3, pass: 4 }

/** One /health/ready read per mount; any failure is "no answer". */
async function fetchReady(): Promise<ReadyBody | null> {
  try {
    const res = await fetch(`${RESOLVED_API_URL}/health/ready`, { signal: AbortSignal.timeout(8000) })
    return (await res.json()) as ReadyBody
  } catch {
    return null
  }
}

export function SelfHostSetupChecklist() {
  const [health, setHealth] = useState<{ loaded: boolean; value: ServerInstance | null }>({ loaded: false, value: null })
  const [ready, setReady] = useState<ReadyBody | null>(null)
  const selfHosted = health.loaded && health.value?.mode === 'self-hosted'
  const doctor = usePageData<DoctorReport>(selfHosted ? '/v1/admin/doctor' : null, { scope: 'none' })

  useEffect(() => {
    let live = true
    void fetchServerInstance().then((value) => {
      if (live) setHealth({ loaded: true, value })
    })
    return () => {
      live = false
    }
  }, [])
  useEffect(() => {
    if (!selfHosted) return
    let live = true
    void fetchReady().then((r) => {
      if (live) setReady(r)
    })
    return () => {
      live = false
    }
  }, [selfHosted])

  // Mushi Cloud, or the server has not answered yet: nothing to set up here.
  if (!selfHosted) return null

  const items = selfHostChecklist({
    apiUrl: RESOLVED_API_URL,
    health: health.value,
    ready,
    doctor: doctor.data ?? null,
    doctorError: doctor.error ? String(doctor.error) : null,
  }).sort((a, b) => RANK[a.status] - RANK[b.status])
  const progress = checklistProgress(items)

  return (
    <SettingsList
      id="self-host-setup"
      title="Self-host setup"
      description="What your own Mushi Mushi server still needs. Optional items (hollow ○) never block anything."
      action={
        <span className="flex items-center gap-1.5 text-2xs font-semibold text-fg-secondary" data-testid="self-host-progress">
          <BarCell value={progress.done} max={progress.total} tone={progress.problems ? 'warn' : 'ok'} label={`${progress.done} of ${progress.total} done`} widthClass="w-12" />
          <span className="tabular-nums">
            {progress.done}/{progress.total}
          </span>
          <Btn size="sm" variant="ghost" onClick={() => doctor.reload()}>
            Re-check
          </Btn>
        </span>
      }
    >
      <ul data-testid="self-host-checklist">
        {items.map((item) => (
          <ChecklistRow key={item.id} item={item} />
        ))}
      </ul>
      <p className="py-1.5 text-2xs text-fg-muted">
        Same checks from a terminal: <code className="font-mono">npx mushi-mushi selfhost doctor</code> ·{' '}
        <a href={SELF_HOST_DOCS} target="_blank" rel="noopener noreferrer" className="underline hover:text-fg">
          Self-hosting guide
        </a>
      </p>
    </SettingsList>
  )
}

function ChecklistRow({ item }: { item: ChecklistItem }) {
  return (
    <li className="flex min-w-0 items-start gap-2 py-1.5" data-testid={`self-host-item-${item.id}`} data-status={item.status}>
      <StatusMark status={MARK[item.status]} label={item.status} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-fg">{item.title}</p>
        <p className="text-xs text-fg-secondary break-words">{item.detail}</p>
        {item.hint ? <p className="mt-0.5 text-2xs text-fg-muted break-words">→ {item.hint}</p> : null}
      </div>
      {item.action?.kind === 'link' ? (
        <Btn to={item.action.to} size="sm" variant="ghost" className="shrink-0">
          {item.action.label}
        </Btn>
      ) : null}
    </li>
  )
}
