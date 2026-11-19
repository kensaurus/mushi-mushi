/**
 * FILE: apps/admin/src/components/journeys/JourneyControls.tsx
 * PURPOSE: The Journey optimizer's two controls: scan the live site
 *          (POST …/journeys/scan) and record visits on demand
 *          (PUT …/journeys/recording, for SDKs on trackSessions 'on-demand').
 */

import { useCallback, useState } from 'react'
import { Link } from 'react-router-dom'
import { Btn, Callout, Card, CopyButton, SegmentedControl } from '../ui'
import { StatusPill, type RunStatus } from '../signal/StatusMark'
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

export function ScanBar({
  data,
  projectId,
  onStarted,
  fallbackUrl = null,
}: {
  data: JourneysData
  projectId: string
  onStarted: () => void
  /**
   * The address the app's SDK last checked in from, for an app with no live
   * address on file: the field started empty although Mushi Mushi knew where
   * the app runs (round-2 review). Arrives after the first render, so the
   * field reads it until the user types.
   */
  fallbackUrl?: string | null
}) {
  const toast = useToast()
  const [typed, setTyped] = useState<string | null>(null)
  const url = typed ?? data.liveUrl ?? fallbackUrl ?? ''
  const setUrl = setTyped
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
    <Card className="min-w-0 p-3">
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
        <Btn
          onClick={start}
          loading={busy || running}
          disabled={!url.trim() || running}
          title={!url.trim() ? SCAN_NEEDS_URL : undefined}
          className="whitespace-nowrap"
          data-testid="journey-scan"
        >
          {running ? 'Scanning…' : scan ? 'Scan again' : 'Scan my site'}
        </Btn>
      </div>
      {/* A disabled button says why (fresh-eyes sweep 2026-11-18): this app has
          no live address on file, so the field starts empty. */}
      {!url.trim() && !running && (
        // A reason, not a warning: neutral ink (round-2 review).
        <p className="mt-1 text-2xs text-fg-muted" data-testid="journey-scan-why">
          {SCAN_NEEDS_URL}
        </p>
      )}
      <p className="mt-2 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-2xs text-fg-faint" aria-live="polite" data-testid="journey-scan-state">
        {scan ? <StatusPill status={SCAN_STATUS[scan.status]} label={SCAN_WORD[scan.status]} /> : null}
        <span className="min-w-0 wrap-anywhere">{scanStatusText(scan, data.mapScan)}</span>
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

  // Only an SDK on trackSessions: 'on-demand' uses this window, and the
  // default records every visit: folded to one row unless a window is on
  // (round-2 review).
  return (
    <Card className="min-w-0 p-3" data-testid="journey-recording">
      <details open={until != null} className="group min-w-0">
      <summary className="flex min-w-0 cursor-pointer select-none list-none flex-wrap items-center justify-between gap-2 [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-fg">
          <span aria-hidden className="text-fg-faint group-open:rotate-90 motion-safe:transition-transform">▸</span>
          Record visits on demand
        </span>
        {until ? (
          <StatusPill status="running" label={`Recording until ${new Date(until).toLocaleString()}`} />
        ) : (
          <StatusPill status="idle" label="Off" />
        )}
      </summary>
      {/* One line (sweep 2026-11-18); the longer story stays on hover. */}
      <p
        className="mt-1 truncate text-2xs text-fg-muted"
        title="Nobody is recorded until you start, so real visitors pay nothing the rest of the time. Apps on the default already record every visit."
        data-testid="journey-recording-hint"
      >
        Only for SDKs on <code className="font-mono">trackSessions: &apos;on-demand&apos;</code>; the default records every visit.
      </p>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        {/* Each choice is named: "1 hour / 1 day / 1 week" and "10% / 50% / Everyone" sat unlabeled. */}
        <div className="flex flex-col gap-0.5" data-testid="journey-recording-duration">
          <span className="text-3xs font-medium text-fg-muted">Duration</span>
          <SegmentedControl size="sm" value={hours} onChange={setHours} ariaLabel="Duration" options={RECORDING_HOURS.map((o) => ({ id: o.id, label: o.label }))} />
        </div>
        <div className="flex flex-col gap-0.5" data-testid="journey-recording-sample">
          <span className="text-3xs font-medium text-fg-muted">Sample of visitors</span>
          <SegmentedControl size="sm" value={sample} onChange={setSample} ariaLabel="Sample of visitors" options={RECORDING_SAMPLES.map((o) => ({ id: o.id, label: o.label }))} />
        </div>
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
      </details>
    </Card>
  )
}

/** @internal Exported for tests. Why Scan my site is disabled. */
export const SCAN_NEEDS_URL = "Enter your live site's address to scan it."

/** The latest scan's state as a mark: scanning pulses, done is ✓, failed ✕. */
const SCAN_STATUS: Record<JourneyScan['status'], RunStatus> = { running: 'running', done: 'passed', failed: 'failed' }
const SCAN_WORD: Record<JourneyScan['status'], string> = { running: 'Scanning', done: 'Scanned', failed: 'Scan failed' }

function scanStatusText(scan: JourneyScan | null, mapScan: JourneyScan | null): string {
  if (!scan) return 'Reads up to 40 public pages with your Firecrawl key (about 41 credits). No AI model, nothing is changed on your site.'
  if (scan.status === 'running') return `${scan.baseUrl}; the map updates by itself.`
  if (mapScan) return `${scan.status === 'failed' ? 'The map is from the last good scan: ' : ''}${mapScan.pageCount} pages of ${mapScan.baseUrl}, ${new Date(mapScan.finishedAt ?? mapScan.createdAt).toLocaleString()}.`
  return 'No finished scan yet.'
}
