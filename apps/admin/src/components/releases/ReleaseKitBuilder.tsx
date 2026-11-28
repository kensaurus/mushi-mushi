/**
 * FILE: apps/admin/src/components/releases/ReleaseKitBuilder.tsx
 * PURPOSE: A release's kit for a product video (Plan 025 P5, ADR 0074): the
 *          before/after screenshots of the screens that changed, clips and
 *          device recordings, the changelog lines and brand, checked inline
 *          against the preset it is built for (App Store preview, Play promo,
 *          9:16 or 1:1 social). Export hands a signed manifest to a video tool
 *          (lazycow `make_product_video({ kitUrl, preset })`); Mushi never
 *          renders video. Store uploads sit below (StoreUploadCards).
 *
 * Data: GET    /v1/admin/projects/:pid/releases/:rid/kit?preset=
 *       PUT    …/kit                         { preset | changelog | clipsEnabled }
 *       POST   …/kit/refresh                 copy the before/after baselines
 *       POST   …/kit/uploads                 signed upload URLs
 *       POST   …/kit/assets/:aid/finalize    { sha256 }
 *       DELETE …/kit/assets/:aid
 *       POST   …/kit/export                  { kitUrl, expiresAt, manifest }
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch, apiFetchMutate } from '../../lib/supabase'
import { actionErrorText } from '../../lib/actionErrorText'
import {
  bytesText,
  handoffSnippet,
  LAZYCOW_PRESET,
  isVideo,
  KIND_LABEL,
  pairScreenshots,
  parseChangelog,
  PRESET_OPTIONS,
  presetSpecText,
  sha256Hex,
  videoAssets,
  type KitAsset,
  type KitExport,
  type KitPreset,
  type ReleaseKitData,
} from '../../lib/releaseShipView'
import { Badge, Card, Btn, Callout, CodeValue, CopyButton, ImageZoom, RelativeTime, SegmentedControl, Skeleton, Textarea, Toggle } from '../ui'
import { ConfirmDialog } from '../ConfirmDialog'
import { PageLoadError } from '../PageLoadError'
import { StoreUploadCards } from './StoreUploadCards'
import { AssetChecks } from './AssetChecks'

interface Props {
  projectId: string
  releaseId: string
  canEdit: boolean
}

type Load =
  | { kind: 'loading' }
  | { kind: 'ready'; data: ReleaseKitData }
  | { kind: 'pending' }
  | { kind: 'error'; message: string; code: string | null }

type Notice = { tone: 'ok' | 'danger' | 'info'; text: string } | null

const RECORDING_ACCEPT = 'video/mp4,video/quicktime,video/webm,.mp4,.mov,.m4v,.webm'

export function ReleaseKitBuilder({ projectId, releaseId, canEdit }: Props) {
  const base = `/v1/admin/projects/${projectId}/releases/${releaseId}/kit`
  const [preset, setPreset] = useState<KitPreset | null>(null)
  const [load, setLoad] = useState<Load>({ kind: 'loading' })
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice>(null)
  const [exported, setExported] = useState<KitExport | null>(null)
  const [removing, setRemoving] = useState<KitAsset | null>(null)
  const [changelogText, setChangelogText] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  // The preset a re-read asks checks for; a ref so reload stays stable.
  const presetRef = useRef<KitPreset | null>(null)

  const reload = useCallback(async (p?: KitPreset | null) => {
    const want = p === undefined ? presetRef.current : p
    const res = await apiFetch<ReleaseKitData>(`${base}${want ? `?preset=${want}` : ''}`, { cache: 'no-store' })
    if (res.ok && res.data && Array.isArray(res.data.assets) && res.data.kit) {
      const data = { ...res.data, storeTargets: res.data.storeTargets ?? [], storeActions: res.data.storeActions ?? [], presets: res.data.presets ?? [] }
      setLoad({ kind: 'ready', data })
      if (!presetRef.current) presetRef.current = data.kit.preset
      setPreset(presetRef.current)
    } else if (res.error?.code === 'MIGRATION_PENDING') setLoad({ kind: 'pending' })
    else setLoad({ kind: 'error', message: res.error?.message ?? 'The release kit could not be read.', code: res.error?.code ?? null })
  }, [base])

  useEffect(() => {
    presetRef.current = null
    void reload(null)
  }, [reload])

  const mutate = async (key: string, path: string, init: { method: string; body?: string }, okText: string): Promise<boolean> => {
    setBusy(key)
    setNotice(null)
    try {
      const res = await apiFetchMutate(path, init)
      setNotice(res.ok ? { tone: 'ok', text: okText } : { tone: 'danger', text: actionErrorText(res.error, 'That did not work. Try again in a minute.') })
      return res.ok
    } finally {
      setBusy(null)
    }
  }

  const choosePreset = async (next: KitPreset) => {
    presetRef.current = next
    setPreset(next)
    if (canEdit) await mutate('preset', base, { method: 'PUT', body: JSON.stringify({ preset: next }) }, `Built for ${PRESET_OPTIONS.find((o) => o.id === next)?.label ?? next}.`)
    await reload(next)
  }

  const refresh = async () => {
    setBusy('refresh')
    setNotice(null)
    try {
      const res = await apiFetchMutate<{ source: string; copied: number; skipped: number }>(`${base}/refresh`, { method: 'POST', body: '{}' })
      if (!res.ok || !res.data) setNotice({ tone: 'danger', text: actionErrorText(res.error, 'The screenshots could not be copied.') })
      else if (res.data.copied === 0) setNotice({ tone: 'info', text: 'No before/after screenshots for this release yet. Run a UX pass or the scorecard, then copy again.' })
      else setNotice({ tone: 'ok', text: `Copied ${res.data.copied} screenshot${res.data.copied === 1 ? '' : 's'} from ${res.data.source === 'ux_baseline' ? 'the pinned baselines' : 'the latest UX runs'}${res.data.skipped ? ` (${res.data.skipped} could not be read)` : ''}.` })
    } finally {
      setBusy(null)
      await reload()
    }
  }

  const uploadRecording = async (file: File) => {
    setBusy('upload')
    setNotice(null)
    try {
      const mime = file.type || (file.name.endsWith('.mov') ? 'video/quicktime' : file.name.endsWith('.webm') ? 'video/webm' : 'video/mp4')
      const reserve = await apiFetchMutate<{ uploads: Array<{ name: string; assetId: string; signedUrl: string }> }>(`${base}/uploads`, {
        method: 'POST',
        body: JSON.stringify({ files: [{ name: file.name.slice(0, 120), kind: 'device_recording', mime, bytes: file.size, source: 'upload', platform: null }] }),
      })
      const slot = reserve.ok ? reserve.data?.uploads?.[0] : undefined
      if (!slot) {
        setNotice({ tone: 'danger', text: actionErrorText(reserve.error, 'The recording could not be reserved.') })
        return
      }
      const buf = await file.arrayBuffer()
      const put = await fetch(slot.signedUrl, { method: 'PUT', headers: { 'Content-Type': mime }, body: buf })
      if (!put.ok) {
        setNotice({ tone: 'danger', text: `The upload stopped (storage answered ${put.status}). Try again.` })
        return
      }
      const fin = await apiFetchMutate(`${base}/assets/${slot.assetId}/finalize`, { method: 'POST', body: JSON.stringify({ sha256: await sha256Hex(buf) }) })
      setNotice(fin.ok ? { tone: 'ok', text: `${file.name} is in the kit.` } : { tone: 'danger', text: actionErrorText(fin.error, 'The recording did not check out.') })
    } finally {
      setBusy(null)
      if (fileInput.current) fileInput.current.value = ''
      await reload()
    }
  }

  const exportKit = async () => {
    setBusy('export')
    setNotice(null)
    try {
      const res = await apiFetchMutate<KitExport>(`${base}/export`, { method: 'POST', body: '{}' })
      if (res.ok && res.data) setExported(res.data)
      else setNotice({ tone: 'danger', text: actionErrorText(res.error, 'The kit could not be exported.') })
    } finally {
      setBusy(null)
    }
  }

  if (load.kind === 'loading') {
    return (
      <div className="space-y-2" aria-busy="true" aria-label="Reading the release kit">
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-24 w-full" />
      </div>
    )
  }
  if (load.kind === 'pending') {
    return (
      <Callout tone="neutral">
        <span role="status">Release kits are not switched on for this server yet (their database update is not applied).</span>
      </Callout>
    )
  }
  if (load.kind === 'error') return <PageLoadError error={load.message} code={load.code} resource="release kit" endpoint={base} onRetry={() => void reload()} />

  const d = load.data
  const active = preset ?? d.kit.preset
  const spec = d.presets.find((p) => p.id === active) ?? null
  const pairs = pairScreenshots(d.assets)
  const videos = videoAssets(d.assets)
  const changelog = changelogText ?? d.kit.changelog.join('\n')
  const parsed = parseChangelog(changelog)

  return (
    <section aria-labelledby={`kit-${releaseId}`} data-testid="release-kit">
      <Card className="space-y-3 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={`kit-${releaseId}`} className="text-xs font-semibold text-fg-secondary">Release kit</h3>
        <span className="inline-flex items-center gap-1.5 rounded-sm border border-edge-subtle bg-surface px-1.5 py-0.5 text-2xs text-fg-secondary" data-testid="kit-brand">
          {d.kit.brand.accent && <span aria-hidden className="h-2.5 w-2.5 rounded-full border border-edge-subtle" style={{ backgroundColor: d.kit.brand.accent }} />}
          {d.kit.brand.name}
        </span>
      </div>

      <SegmentedControl<KitPreset> ariaLabel="Build the kit for" value={active} options={PRESET_OPTIONS} onChange={(p) => void choosePreset(p)} wrap disabled={busy === 'preset'} />
      {spec && (
        <div className="rounded-sm border border-edge-subtle bg-surface p-2 text-2xs text-fg-muted" data-testid="preset-spec">
          <p className="font-medium text-fg">{spec.label}: {presetSpecText(spec)}</p>
          <p>{spec.output.note}</p>
          <p className="text-fg-faint">Goes to: {spec.destination}</p>
        </div>
      )}

      <div className={`rounded-sm border p-2 text-2xs ${d.readiness.ready ? 'border-edge-subtle text-fg-muted' : 'border-warn/40 text-fg-secondary'}`} role="status">
        {d.readiness.screenshots} screenshot{d.readiness.screenshots === 1 ? '' : 's'} · {d.readiness.videos} video{d.readiness.videos === 1 ? '' : 's'}
        {d.readiness.ready ? ' · ready to export' : ''}
        {d.readiness.problems.length > 0 && (
          <ul role="list" className="mt-1 list-disc pl-4">
            {d.readiness.problems.map((p) => <li key={p}>{p}</li>)}
          </ul>
        )}
        {(d.readiness.recommended ?? []).length > 0 && (
          <ul role="list" className="mt-1 list-disc pl-4 text-fg-muted" data-testid="kit-recommended">
            {(d.readiness.recommended ?? []).map((p) => <li key={p}>{p}</li>)}
          </ul>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Btn size="sm" variant="ghost" loading={busy === 'refresh'} disabled={!canEdit || busy !== null} title={canEdit ? 'Copy the before/after screenshots of this release into the kit' : 'Viewers cannot change the kit.'} onClick={() => void refresh()}>Copy baselines</Btn>
        <Btn size="sm" variant="ghost" loading={busy === 'upload'} disabled={!canEdit || busy !== null} title={canEdit ? `A screen recording from a device, up to ${d.settings.clipMaxMb} MB` : 'Viewers cannot change the kit.'} onClick={() => fileInput.current?.click()}>Upload recording</Btn>
        <input
          ref={fileInput}
          type="file"
          accept={RECORDING_ACCEPT}
          className="sr-only"
          aria-label="Choose a device recording"
          tabIndex={-1}
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void uploadRecording(f)
          }}
        />
        <Btn size="sm" loading={busy === 'export'} disabled={!canEdit || busy !== null} title={canEdit ? 'Sign the kit for a video tool (24 hours)' : 'Viewers cannot export the kit.'} onClick={() => void exportKit()}>Export for a product video</Btn>
      </div>

      {notice && (
        <Callout tone={notice.tone}>
          <span role="status">{notice.text}</span>
        </Callout>
      )}

      {exported && (
        <div className="space-y-1 rounded-sm border border-edge-subtle bg-surface p-2 text-2xs" data-testid="kit-export">
          <div className="flex flex-wrap items-center gap-1 text-fg-muted">
            <span>Kit URL, valid until</span>
            <RelativeTime value={exported.expiresAt} />
            <CopyButton value={exported.kitUrl} label="Copy the kit URL" />
          </div>
          <p className="text-fg-faint">Give it to your video tool. With lazycow:</p>
          <CodeValue value={handoffSnippet(exported.kitUrl, exported.preset ?? LAZYCOW_PRESET[active])} multiline />
        </div>
      )}

      <div>
        <h4 className="mb-1 text-2xs font-semibold text-fg-secondary">Before and after</h4>
        {pairs.length === 0 ? (
          <p className="text-2xs text-fg-faint">No screenshots yet. "Copy baselines" brings in the screens that changed in this release.</p>
        ) : (
          <ul role="list" className="grid grid-cols-1 gap-2 sm:grid-cols-2" data-testid="kit-pairs">
            {pairs.map((p) => (
              <li key={p.key} className="space-y-1 rounded-sm border border-edge-subtle bg-surface p-2">
                <p className="truncate text-2xs font-medium text-fg">{p.surfacePath ?? 'Screen'}{p.viewport ? ` · ${p.viewport}` : ''}</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {([['Before', p.before], ['After', p.after]] as const).map(([label, a]) => (
                    <figure key={label} className="min-w-0 space-y-0.5">
                      {a?.url ? (
                        <ImageZoom src={a.url} alt={`${p.surfacePath ?? 'Screen'} ${label.toLowerCase()}`} thumbClassName="h-24" />
                      ) : (
                        <div className="flex h-24 items-center justify-center rounded-sm border border-dashed border-edge-subtle text-3xs text-fg-faint">No {label.toLowerCase()}</div>
                      )}
                      <figcaption className="text-3xs text-fg-faint">{label}</figcaption>
                      {a && <AssetChecks asset={a} />}
                      {a && canEdit && <Btn size="sm" variant="ghost" aria-label={`Remove the ${label.toLowerCase()} screenshot of ${p.surfacePath ?? 'this screen'}`} onClick={() => setRemoving(a)}>Remove</Btn>}
                    </figure>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h4 className="mb-1 text-2xs font-semibold text-fg-secondary">Clips and recordings</h4>
        {videos.length === 0 ? (
          <p className="text-2xs text-fg-faint">No footage yet. Web apps: turn on clips below and run <code className="font-mono">mushi-ux clips</code>. Native apps: upload a screen recording.</p>
        ) : (
          <ul role="list" className="grid grid-cols-1 gap-2 sm:grid-cols-2" data-testid="kit-videos">
            {videos.map((v) => (
              <li key={v.id} className="space-y-1 rounded-sm border border-edge-subtle bg-surface p-2">
                <div className="flex flex-wrap items-center gap-1.5 text-2xs">
                  <Badge tone="neutral">{KIND_LABEL[v.kind]}</Badge>
                  <span className="truncate text-fg">{v.label ?? v.storage_path.split('/').pop()}</span>
                  {v.status !== 'ready' && <Badge tone={v.status === 'rejected' ? 'danger' : 'warn'}>{v.status === 'rejected' ? 'Rejected' : 'Uploading'}</Badge>}
                </div>
                {v.url && isVideo(v) ? (
                  <video src={v.url} controls muted preload="metadata" playsInline className="max-h-48 w-full rounded-sm border border-edge-subtle bg-surface-overlay" aria-label={v.label ?? KIND_LABEL[v.kind]}>
                    <track kind="captions" />
                  </video>
                ) : (
                  <div className="flex h-20 items-center justify-center rounded-sm border border-dashed border-edge-subtle text-3xs text-fg-faint">Preview after the upload finishes</div>
                )}
                <p className="text-3xs text-fg-faint">
                  {[v.width && v.height ? `${v.width}×${v.height}` : null, v.duration_ms ? `${(v.duration_ms / 1000).toFixed(1)} s` : null, v.fps ? `${v.fps} fps` : null, bytesText(v.bytes), v.metadata_from === 'declared' ? 'as declared' : null].filter(Boolean).join(' · ')}
                </p>
                <AssetChecks asset={v} />
                {canEdit && <Btn size="sm" variant="ghost" aria-label={`Remove ${v.label ?? 'this video'}`} onClick={() => setRemoving(v)}>Remove</Btn>}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-1">
        <Toggle
          label="Record clips for release kits"
          checked={d.settings.clipsEnabled}
          disabled={!canEdit || busy !== null}
          onChange={(next) => void mutate('clips', base, { method: 'PUT', body: JSON.stringify({ clipsEnabled: next }) }, next ? 'Clips are on for this app.' : 'Clips are off.').then(() => reload())}
        />
        <p className="text-3xs text-fg-faint">Off by default. When on, <code className="font-mono">mushi-ux clips</code> may record your top flows with Playwright: at most {d.settings.clipMaxSeconds} s and {d.settings.clipMaxMb} MB each, 12 per kit. Clips are WebM footage for the video tool, not store-ready on their own.</p>
      </div>

      <div className="space-y-1">
        <Textarea
          label="What the video says (one line each)"
          value={changelog}
          rows={4}
          disabled={!canEdit}
          error={parsed.problem ?? undefined}
          onChange={(e) => setChangelogText(e.target.value)}
        />
        <Btn
          size="sm"
          variant="ghost"
          loading={busy === 'changelog'}
          disabled={!canEdit || changelogText === null || !!parsed.problem || busy !== null}
          title={canEdit ? 'Save these lines for the video' : 'Viewers cannot change the kit.'}
          onClick={() => void mutate('changelog', base, { method: 'PUT', body: JSON.stringify({ changelog: parsed.lines }) }, 'Lines saved.').then((ok) => { if (ok) setChangelogText(null); return reload() })}
        >
          Save lines
        </Btn>
      </div>

      <StoreUploadCards projectId={projectId} releaseId={releaseId} data={d} canEdit={canEdit} onChanged={() => void reload()} />

      {removing && (
        <ConfirmDialog
          title="Remove this from the kit?"
          body="The file is deleted from the kit. An upload already sent to a store is not affected."
          confirmLabel="Remove"
          tone="danger"
          loading={busy === 'remove'}
          onCancel={() => setRemoving(null)}
          onConfirm={async () => {
            await mutate('remove', `${base}/assets/${removing.id}`, { method: 'DELETE' }, 'Removed.')
            setRemoving(null)
            await reload()
          }}
        />
      )}
      </Card>
    </section>
  )
}
