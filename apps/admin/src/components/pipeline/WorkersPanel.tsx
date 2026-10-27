/**
 * FILE: apps/admin/src/components/pipeline/WorkersPanel.tsx
 * PURPOSE: /pipeline "Workers" tab (ADR 0048): the local workers that run
 *          `mushi work --daemon` on your own machines. The console's version
 *          of `lanectl status`, and its controls:
 *
 *            - each machine: online or not, its last heartbeat, what it is
 *              doing, its readings, and the guards it applies (free memory,
 *              GitHub API calls left, agents at once), editable by its owner,
 *              and Revoke;
 *            - each lane: model, mode, runs at once, pause, drain, stop date,
 *              what it runs now, its queue in order (move, remove), its last
 *              runs with PRs, timeouts and errors.
 *
 *          The machine pulls these settings at its next heartbeat (within a
 *          minute); the server never reaches into the machine.
 *
 * Data: GET /v1/admin/work/lanes?projectId= (lib/workers.ts)
 */

import { useCallback, useState } from 'react'
import { ConfirmDialog } from '../ConfirmDialog'
import { PageLoadError } from '../PageLoadError'
import { Badge, Btn, Card, CodeValue, HelpPopover, Input, Loading, PageFirstStep, PageStatus, Section } from '../ui'
import { IconServer } from '../icons'
import { usePageData } from '../../lib/usePageData'
import { useToast } from '../../lib/toast'
import {
  patchHostGuards,
  patchLane,
  putQueue,
  revokeHost,
  sinceLabel,
  workersSummary,
  type HostGuards,
  type LaneSettings,
  type WorkerHost,
  type WorkerLane,
  type WorkLanesData,
} from '../../lib/workers'
import { WorkerKeyForm } from './WorkerKeyForm'
import { WorkerLaneCard } from './WorkerLaneCard'

interface Props {
  /** One app, or null for every app the caller can open. */
  projectId: string | null
  now: number
}

const INSTALL_ONE = 'mushi worker install --lane my-app --project <app id> --repo-dir ~/src/my-app'
const INSTALL_CONF = 'mushi worker install --lanes-conf ./lanes.conf --clone-root ~/.cache/mushi-work'

function HostCard({ host, now, onChanged }: { host: WorkerHost; now: number; onChanged: () => void }) {
  const [guards, setGuards] = useState<HostGuards>(host.guards)
  const [busy, setBusy] = useState(false)
  const [asking, setAsking] = useState(false)
  const toast = useToast()
  const changed = (Object.keys(guards) as Array<keyof HostGuards>).filter((k) => guards[k] !== host.guards[k])
  const s = host.status
  const testId = `worker-host-${host.id}`

  const saveGuards = async () => {
    setBusy(true)
    const res = await patchHostGuards(host.id, Object.fromEntries(changed.map((k) => [k, guards[k]])))
    setBusy(false)
    ;(res.ok ? toast.success : toast.error)(res.message)
    if (res.ok) onChanged()
  }
  const revoke = async () => {
    setBusy(true)
    const res = await revokeHost(host.id)
    setBusy(false)
    setAsking(false)
    ;(res.ok ? toast.success : toast.error)(res.message)
    if (res.ok) onChanged()
  }

  return (
    <li data-testid={testId}>
      <Card className="space-y-2 p-3">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-xs font-semibold text-fg">{host.hostname}</span>
        <Badge tone="neutral">{host.platform}</Badge>
        <Badge tone={host.revoked ? 'danger' : host.online ? 'ok' : 'warn'}>{host.revoked ? 'revoked' : host.online ? 'online' : 'offline'}</Badge>
        <span className="text-2xs text-fg-muted" data-testid={`${testId}-heartbeat`}>
          last heartbeat {sinceLabel(host.lastHeartbeatAt, now)}
          {s.state ? ` · ${String(s.state)}` : ''}
          {s.agents != null ? ` · ${String(s.agents)} of ${host.guards.max_agents} agents` : ''}
        </span>
      </div>
      <p className="text-2xs text-fg-muted">
        {s.memAvailableGb != null ? `${String(s.memAvailableGb)} GB free` : 'free memory not reported'}
        {s.ghRemaining != null ? ` · ${String(s.ghRemaining)} GitHub API calls left` : ''}
        {s.cursor ? ` · Cursor ${String(s.cursor).replace('_', ' ')}` : ''}
        {host.version ? ` · mushi ${host.version}` : ''}
      </p>
      {host.mine && !host.revoked ? (
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-28">
            <Input id={`${testId}-max-agents-input`} label="Agents at once" type="number" min={1} max={16} value={guards.max_agents} onChange={(e) => setGuards({ ...guards, max_agents: Number(e.target.value) })} data-testid={`${testId}-max-agents`} />
          </div>
          <div className="w-28">
            <Input id={`${testId}-mem-input`} label="Free memory floor (GB)" type="number" min={0} max={256} value={guards.min_free_mem_gb} onChange={(e) => setGuards({ ...guards, min_free_mem_gb: Number(e.target.value) })} />
          </div>
          <div className="w-32">
            <Input id={`${testId}-gh-input`} label="GitHub calls floor" type="number" min={0} max={5000} value={guards.gh_floor} onChange={(e) => setGuards({ ...guards, gh_floor: Number(e.target.value) })} />
          </div>
          <Btn size="sm" variant="ghost" disabled={changed.length === 0} loading={busy && !asking} onClick={() => void saveGuards()} data-testid={`${testId}-guards-save`}>
            Save limits
          </Btn>
          <Btn size="sm" variant="danger" onClick={() => setAsking(true)} data-testid={`${testId}-revoke`}>
            Revoke
          </Btn>
        </div>
      ) : (
        <p className="text-2xs text-fg-faint">
          Limits: {host.guards.max_agents} agents at once, waits under {host.guards.min_free_mem_gb} GB free or {host.guards.gh_floor} GitHub calls left.
          {!host.mine && ' Only its owner changes them.'}
        </p>
      )}
      {asking && (
        <ConfirmDialog
          title={`Revoke ${host.hostname}`}
          body="Its worker key stops working and the machine stops at its next heartbeat, within a minute. Runs in progress are stopped. To use the machine again, run mushi worker install there."
          confirmLabel="Revoke"
          tone="danger"
          loading={busy}
          onConfirm={() => void revoke()}
          onCancel={() => setAsking(false)}
        />
      )}
      </Card>
    </li>
  )
}

export function WorkersPanel({ projectId, now }: Props) {
  const path = projectId ? `/v1/admin/work/lanes?projectId=${encodeURIComponent(projectId)}` : '/v1/admin/work/lanes'
  const page = usePageData<WorkLanesData>(path, { scope: projectId ? 'project' : 'enumeration' })
  const { data, reload } = page
  const [showKeyForm, setShowKeyForm] = useState(false)
  const toast = useToast()

  const onPatch = useCallback(
    async (lane: WorkerLane, patch: LaneSettings) => {
      const res = await patchLane(lane.id, patch)
      if (res.ok) reload()
      else toast.error(res.message)
      return res
    },
    [reload, toast],
  )
  const onQueue = useCallback(
    async (lane: WorkerLane, reportIds: string[], append = false) => {
      const res = await putQueue(lane.id, reportIds, append)
      if (res.ok) reload()
      else toast.error(res.message)
      return res
    },
    [reload, toast],
  )

  if (page.error) return <PageLoadError error={page.error} resource="the local workers" endpoint={path} onRetry={reload} />
  if (page.loading && !data) return <Loading text="Reading the local workers…" />
  if (!data || !Array.isArray(data.hosts)) return null

  const hosts = new Map(data.hosts.map((h) => [h.id, h]))
  const sum = workersSummary(data, now)
  const showApp = !projectId && new Set(data.lanes.map((l) => l.projectId)).size > 1
  const help = (
    <HelpPopover label="How local workers work" title="Local workers" align="start">
      <p>
        A local worker is <code>mushi work --daemon</code> on your own machine. Every minute it checks in, reads the settings you set here, and takes one report at a time for
        each lane: the lane&apos;s queue first, then the worst open reports. Its coding agent fixes the report in a copy of your repo; the worker opens the pull request with your
        own git and gh.
      </p>
      <p>
        <strong>Taking a report</strong> holds it for 45 minutes at a time, renewed every minute, so no cloud agent works on it at the same time. A worker that goes quiet loses it.
      </p>
      <p>
        <strong>Drain</strong> lets the lane finish what it runs and take nothing new. <strong>The machine&apos;s fault</strong> (a lost network, a full disk, a hook refusing under
        load) never counts against a report: it goes back to the front of the queue once on its own.
      </p>
    </HelpPopover>
  )

  if (data.hosts.length === 0) {
    return (
      <div className="space-y-3" data-testid="workers-empty">
        <PageFirstStep
          marksPageEmpty={false}
          icon={<IconServer size={16} />}
          title="No local worker yet"
          sentence="A local worker fixes reports on your own machine with your Cursor account, and you steer it from here. Create its key below, then run the install on that machine."
          action={{ label: 'Create a worker key', onClick: () => setShowKeyForm(true) }}
          data-testid="workers-first-step"
        />
        <Section title="Set up a worker" id="workers-setup" action={help}>
          <div className="space-y-2 text-xs text-fg-muted">
            <p>On the machine, with the Cursor CLI and gh signed in:</p>
            <CodeValue value={INSTALL_ONE} multiline />
            <p>Already run lanes from a lanes.conf file (name, profile, clone, app id, model, mode)? Import it; each lane keeps its model, and its queue now lives here:</p>
            <CodeValue value={INSTALL_CONF} multiline />
            {showKeyForm && <WorkerKeyForm projects={data.projects} onCreated={reload} />}
          </div>
        </Section>
      </div>
    )
  }

  return (
    <div className="space-y-4" data-testid="workers-panel">
      <PageStatus
        data-testid="workers-status"
        ariaLabel="Local workers"
        sentence={sum.sentence}
        tone={sum.tone}
        metrics={[
          { label: 'Workers online', value: sum.online },
          { label: 'Lanes taking reports', value: sum.taking },
          { label: 'Reports queued', value: sum.queued },
        ]}
        action={
          <span className="flex flex-wrap items-center gap-2">
            {help}
            <Btn size="sm" variant="ghost" onClick={() => setShowKeyForm((v) => !v)} data-testid="workers-new-key">
              {showKeyForm ? 'Close' : 'New worker key'}
            </Btn>
          </span>
        }
      />
      {showKeyForm && (
        <Section title="New worker key" id="workers-new-key-form">
          <WorkerKeyForm projects={data.projects} onCreated={reload} />
        </Section>
      )}

      <Section title={`Machines (${data.hosts.length})`} id="workers-hosts" icon={<IconServer />}>
        <ul className="space-y-2">
          {data.hosts.map((h) => (
            <HostCard key={`${h.id}:${h.lastHeartbeatAt}`} host={h} now={now} onChanged={reload} />
          ))}
        </ul>
      </Section>

      <Section title={`Lanes (${data.lanes.length})`} id="workers-lanes">
        {data.lanes.length === 0 ? (
          <p className="text-xs text-fg-muted">No lane registered yet: a machine registers its lanes at its first heartbeat.</p>
        ) : (
          <ul className="space-y-2">
            {data.lanes.map((l) => (
              <WorkerLaneCard key={`${l.id}:${JSON.stringify(l.config)}:${l.reviewModel ?? ''}`} lane={l} host={hosts.get(l.hostId)} now={now} showApp={showApp} onPatch={onPatch} onQueue={onQueue} />
            ))}
          </ul>
        )}
      </Section>
    </div>
  )
}
