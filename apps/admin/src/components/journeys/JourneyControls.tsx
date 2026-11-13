/**
 * FILE: apps/admin/src/components/journeys/JourneyControls.tsx
 * PURPOSE: The Journey optimizer's two controls: scan the live site
 *          (POST …/journeys/scan) and record visits on demand
 *          (PUT …/journeys/recording, for SDKs on trackSessions 'on-demand').
 */

import { useCallback, useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Btn, Callout, Card, CopyButton, SegmentedControl } from '../ui'
import { apiFetchMutate } from '../../lib/supabase'
import { useToast } from '../../lib/toast'
import {
  RECORDING_HOURS,
  RECORDING_SAMPLES,
  journeyRecordingPath,
  journeyScanPath,
  testLink,
  type JourneyScan,
  type JourneysData,
} from '../../lib/journeys'

export function ScanBar({ data, projectId, onStarted }: { data: JourneysData; projectId: string; onStarted: () => void }) {
  const toast = useToast()
  const [url, setUrl] = useState(data.liveUrl ?? '')
  const [busy, setBusy] = useState(false)
  const scan = data.scan
  const running = scan?.status === 'running'

  const start = useCallback(async () => {
    setBusy(true)
    const trimmed = url.trim()
    const res = await apiFetchMutate<{ scan: JourneyScan }>(journeyScanPath(projectId), {
      method: 'POST',
      body: JSON.stringify(trimmed && trimmed !== data.liveUrl ? { base_url: trimmed } : {}),
    })
    setBusy(false)
    if (!res.ok) {
      toast.error("Couldn't start the scan", res.error?.message)
      return
    }
    toast.success('Scanning your site', 'Firecrawl reads the pages on its side; it usually takes a few minutes. The map updates by itself.')
    onStarted()
  }, [url, projectId, data.liveUrl, toast, onStarted])

  return (
    <Card className="p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-2xs text-fg-muted">
          Your live site
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://your-app.com"
            className="min-w-0 rounded-md border border-edge bg-surface px-2 py-1.5 font-mono text-xs text-fg focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
            aria-label="Your live site address"
          />
        </label>
        <Btn onClick={start} loading={busy || running} disabled={!url.trim() || running} data-testid="journey-scan">
          {running ? 'Scanning…' : scan ? 'Scan again' : 'Scan my site'}
        </Btn>
      </div>
      <p className="mt-2 text-2xs text-fg-faint" aria-live="polite">
        {scanStatusText(scan, data.mapScan)}
      </p>
      {scan?.status === 'failed' && scan.error && (
        <Callout tone="danger" className="mt-2" label="The last scan failed">
          {scan.error}
          {scan.error.includes('AI keys') && (
            <>
              {' '}
              <Link className="text-brand underline" to="/settings?tab=byok">Open AI keys</Link>
            </>
          )}
        </Callout>
      )}
    </Card>
  )
}

export function RecordingCard({ data, projectId, onChanged }: { data: JourneysData; projectId: string; onChanged: () => void }) {
  const toast = useToast()
  const [hours, setHours] = useState<(typeof RECORDING_HOURS)[number]['id']>('24')
  const [sample, setSample] = useState<(typeof RECORDING_SAMPLES)[number]['id']>(() => {
    const match = RECORDING_SAMPLES.find((s) => Number(s.id) === data.recording?.sampleRate)
    return match?.id ?? '0.1'
  })
  const [busy, setBusy] = useState(false)
  const until = data.recording?.until ?? null
  const link = testLink(data.liveUrl)

  const save = useCallback(
    async (h: number) => {
      setBusy(true)
      const res = await apiFetchMutate<{ recording: { until: string | null; sampleRate: number } }>(journeyRecordingPath(projectId), {
        method: 'PUT',
        body: JSON.stringify(h === 0 ? { hours: 0 } : { hours: h, sample_rate: Number(sample) }),
      })
      setBusy(false)
      if (!res.ok) {
        toast.error(h === 0 ? "Couldn't stop recording" : "Couldn't start recording", res.error?.message)
        return
      }
      toast.success(h === 0 ? 'Recording stopped' : 'Recording visits', h === 0 ? 'Pages loaded from now on record nothing; open pages stop when reloaded.' : 'Pages loaded from now on start recording.')
      onChanged()
    },
    [projectId, sample, toast, onChanged],
  )

  return (
    <Card className="p-3" data-testid="journey-recording">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium text-fg">Record visits on demand</p>
        {until ? <Badge tone="okSubtle">Recording until {new Date(until).toLocaleString()}</Badge> : <Badge tone="neutral">Off</Badge>}
      </div>
      <p className="mt-1 text-2xs text-fg-muted">
        For apps that run the SDK with <code className="font-mono">trackSessions: &apos;on-demand&apos;</code>: nobody is recorded until you start, so real visitors pay nothing the rest of the time. Apps on the default already record every visit.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <SegmentedControl size="sm" value={hours} onChange={setHours} ariaLabel="How long" options={RECORDING_HOURS.map((o) => ({ id: o.id, label: o.label }))} />
        <SegmentedControl size="sm" value={sample} onChange={setSample} ariaLabel="Share of visitors" options={RECORDING_SAMPLES.map((o) => ({ id: o.id, label: o.label }))} />
        <Btn size="sm" onClick={() => save(Number(hours))} loading={busy}>
          {until ? 'Restart' : 'Start'}
        </Btn>
        {until && (
          <Btn size="sm" variant="ghost" onClick={() => save(0)} disabled={busy}>
            Stop
          </Btn>
        )}
      </div>
      {link && (
        <div className="mt-2 flex min-w-0 items-center gap-1.5 text-2xs text-fg-muted">
          <span className="shrink-0">Test in your own browser:</span>
          <code className="min-w-0 truncate font-mono text-fg-secondary" title={link}>{link}</code>
          <CopyButton value={link} label="Copy test link" copiedLabel="Copied" />
        </div>
      )}
    </Card>
  )
}

function scanStatusText(scan: JourneyScan | null, mapScan: JourneyScan | null): string {
  if (!scan) return 'Reads up to 40 public pages with your Firecrawl key (about 41 credits). No AI model, nothing is changed on your site.'
  if (scan.status === 'running') return `Scanning ${scan.baseUrl}… the map updates by itself when it is done.`
  if (mapScan) return `Last scan: ${mapScan.pageCount} pages of ${mapScan.baseUrl}, ${new Date(mapScan.finishedAt ?? mapScan.createdAt).toLocaleString()}.`
  return 'No finished scan yet.'
}
