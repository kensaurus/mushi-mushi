/**
 * FILE: apps/admin/src/components/releases/StoreUploadCards.tsx
 * PURPOSE: Store media from a release kit (Plan 025 P6, ADR 0074): ask to put
 *          screenshots or an app preview on App Store Connect, or listing
 *          images / the promo video on Google Play, then approve and run that
 *          one request. Nothing uploads on its own: the approval covers the
 *          exact payload shown (each file's SHA-256 included), expires after
 *          an hour, and runs once (ADR 0017's exception).
 *
 * Data: POST …/releases/:rid/kit/store-upload                      (ask; 422 SPEC_CHECK_FAILED inline)
 *       POST /v1/admin/orgs/:orgId/connector-actions/:id/approve   { payloadSha256 }
 *       POST /v1/admin/orgs/:orgId/connector-actions/:id/reject
 *       POST …/releases/:rid/kit/store-upload/:id/execute           (run once; only this route carries the uploaders)
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetchMutate } from '../../lib/supabase'
import { actionErrorText } from '../../lib/actionErrorText'
import { LINK_ACCENT } from '../../lib/chipTone'
import {
  assetsForAction,
  defaultStoreForm,
  deviceTypesFor,
  KIND_LABEL,
  STORE_ACTION_LABEL,
  STORE_ACTION_STATUS,
  STORE_KIND_LABEL,
  storeUploadBody,
  type ReleaseKitData,
  type StoreAction,
  type StoreFormState,
  type StoreTarget,
} from '../../lib/releaseShipView'
import { Badge, Btn, Callout, Checkbox, DisclosurePanel, Input, SelectField } from '../ui'
import { ConfirmDialog } from '../ConfirmDialog'
import { AssetChecks } from './AssetChecks'

interface Props {
  projectId: string
  releaseId: string
  data: ReleaseKitData
  canEdit: boolean
  onChanged: () => void
}

type Notice = { tone: 'ok' | 'danger'; text: string } | null

export function StoreUploadCards({ projectId, releaseId, data, canEdit, onChanged }: Props) {
  const [notice, setNotice] = useState<Notice>(null)
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<{ row: StoreAction; kind: 'execute' | 'reject' } | null>(null)
  const orgPath = data.organizationId ? `/v1/admin/orgs/${data.organizationId}/connector-actions` : null

  const decide = async (row: StoreAction, step: 'approve' | 'execute' | 'reject') => {
    if (!orgPath) return
    setBusy(true)
    setNotice(null)
    try {
      const body = step === 'approve' ? { payloadSha256: row.payload_sha256 } : {}
      // Running happens on the kit's own route: the only one that carries the store uploaders (api-ext, ADR 0074).
      const res = step === 'execute'
        ? await apiFetchMutate(`/v1/admin/projects/${projectId}/releases/${releaseId}/kit/store-upload/${row.id}/execute`, { method: 'POST', body: '{}' })
        : await apiFetchMutate(`${orgPath}/${row.id}/${step}`, { method: 'POST', body: JSON.stringify(body) })
      const okText = step === 'approve' ? 'Approved for one hour. Run it when ready.' : step === 'execute' ? 'Sent to the store once.' : 'Rejected.'
      setNotice(res.ok ? { tone: 'ok', text: okText } : { tone: 'danger', text: actionErrorText(res.error, 'That did not work. Try again in a minute.') })
    } finally {
      setBusy(false)
      onChanged()
    }
  }

  return (
    <div className="space-y-2" data-testid="store-uploads">
      <h4 className="text-2xs font-semibold text-fg-secondary">To the stores</h4>
      {data.storeTargets.length === 0 ? (
        <p className="text-2xs text-fg-faint">
          No App Store Connect or Google Play connector is bound to this app. Connect one under{' '}
          <Link to="/portfolio" className={LINK_ACCENT}>Portfolio → Connectors</Link>
          , then upload screenshots and previews from here, each approved by a person first.
        </p>
      ) : (
        <ul role="list" className="grid grid-cols-1 gap-2">
          {data.storeTargets.map((t) => (
            <li key={t.connectorId}>
              <StoreTargetCard projectId={projectId} releaseId={releaseId} target={t} data={data} canEdit={canEdit} onAsked={(text) => { setNotice({ tone: 'ok', text }); onChanged() }} />
            </li>
          ))}
        </ul>
      )}

      {notice && (
        <Callout tone={notice.tone}>
          <span role="status">{notice.text}</span>
        </Callout>
      )}

      {data.storeActions.length > 0 && (
        <ul role="list" aria-label="Store upload requests" className="flex flex-col divide-y divide-edge-subtle rounded-sm border border-edge-subtle bg-surface" data-testid="store-actions">
          {data.storeActions.map((a) => {
            const st = STORE_ACTION_STATUS[a.status] ?? STORE_ACTION_STATUS.pending_approval
            return (
              <li key={a.id} className="flex flex-col gap-1 p-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-medium text-fg">
                    {STORE_ACTION_LABEL[a.action] ?? a.action} <Badge tone={st.tone}>{st.label}</Badge>
                  </span>
                  <div className="flex gap-2">
                    {a.status === 'pending_approval' && <Btn size="sm" variant="success" disabled={busy || !orgPath} title="Approve exactly this payload for one hour" onClick={() => void decide(a, 'approve')}>Approve</Btn>}
                    {a.status === 'approved' && <Btn size="sm" disabled={busy || !orgPath} title="Send it to the store once" onClick={() => setConfirm({ row: a, kind: 'execute' })}>Run now</Btn>}
                    {(a.status === 'pending_approval' || a.status === 'approved') && <Btn size="sm" variant="ghost" disabled={busy || !orgPath} title="Close this request" onClick={() => setConfirm({ row: a, kind: 'reject' })}>Reject</Btn>}
                  </div>
                </div>
                <p className="text-3xs text-fg-faint">
                  Asked {new Date(a.requested_at).toLocaleString()}
                  {a.expires_at ? ` · approval ends ${new Date(a.expires_at).toLocaleTimeString()}` : ''} · hash {a.payload_sha256.slice(0, 12)}
                </p>
                {a.reason && <p className="text-2xs text-fg-muted">{a.reason}</p>}
                {a.payload && (
                  <DisclosurePanel title="The exact payload">
                    <pre className="overflow-x-auto p-2 font-mono text-2xs text-fg-secondary">{JSON.stringify(a.payload, null, 2)}</pre>
                  </DisclosurePanel>
                )}
                {a.error && <p className="text-2xs text-danger">{a.error}</p>}
              </li>
            )
          })}
        </ul>
      )}

      {confirm && (
        <ConfirmDialog
          title={confirm.kind === 'execute' ? `Run "${STORE_ACTION_LABEL[confirm.row.action] ?? confirm.row.action}" now?` : 'Reject this request?'}
          body={confirm.kind === 'execute'
            ? 'This sends the approved files to the store once. It changes the live listing media and cannot be undone from Mushi Mushi.'
            : 'The request closes and cannot be approved later. Ask again if you change your mind.'}
          confirmLabel={confirm.kind === 'execute' ? 'Run now' : 'Reject'}
          tone="danger"
          loading={busy}
          onCancel={() => setConfirm(null)}
          onConfirm={async () => {
            const { row, kind } = confirm
            await decide(row, kind)
            setConfirm(null)
          }}
        />
      )}
    </div>
  )
}

function StoreTargetCard({ projectId, releaseId, target, data, canEdit, onAsked }: { projectId: string; releaseId: string; target: StoreTarget; data: ReleaseKitData; canEdit: boolean; onAsked: (text: string) => void }) {
  const [form, setForm] = useState<StoreFormState>(() => defaultStoreForm(target))
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const choices = assetsForAction(data.assets, form.action)
  const devices = deviceTypesFor(form.action)
  const needsAssets = form.action !== 'set_promo_video'
  const canAsk = canEdit && !busy && form.locale.trim().length >= 2 && (needsAssets ? form.assetIds.length > 0 : form.youtubeUrl.trim().length > 0)

  const ask = async () => {
    setBusy(true)
    setProblem(null)
    try {
      const res = await apiFetchMutate<{ actionId: string }>(`/v1/admin/projects/${projectId}/releases/${releaseId}/kit/store-upload`, {
        method: 'POST',
        body: JSON.stringify(storeUploadBody(target, form)),
      })
      if (res.ok) {
        setForm(defaultStoreForm(target))
        onAsked('Asked. An owner or admin approves it below before anything is uploaded.')
      } else setProblem(actionErrorText(res.error, 'The request could not be saved.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2 rounded-sm border border-edge-subtle bg-surface p-2" data-testid={`store-target-${target.kind}`}>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-medium text-fg">{STORE_KIND_LABEL[target.kind]}</span>
        <span className="text-fg-faint">{target.name} · {target.externalId}</span>
      </div>
      {!target.actEnabled && (
        <Callout tone="warn">
          Turn on Act for this connector and add a write key before an approved upload can run.{' '}
          <Link to="/portfolio" className={LINK_ACCENT}>Open Portfolio</Link>
        </Callout>
      )}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <SelectField label="What" value={form.action} disabled={!canEdit} onChange={(e) => setForm({ ...form, action: e.target.value, deviceType: deviceTypesFor(e.target.value)[0] ?? '', assetIds: [] })}>
          {target.actions.map((a) => <option key={a} value={a}>{STORE_ACTION_LABEL[a] ?? a}</option>)}
        </SelectField>
        <Input label="Language" value={form.locale} disabled={!canEdit} onChange={(e) => setForm({ ...form, locale: e.target.value })} spellCheck={false} autoComplete="off" />
        {devices.length > 0 && (
          <SelectField label={form.action === 'upload_listing_images' ? 'Image type' : 'Device'} value={form.deviceType} disabled={!canEdit} onChange={(e) => setForm({ ...form, deviceType: e.target.value })}>
            {devices.map((d) => <option key={d} value={d}>{d}</option>)}
          </SelectField>
        )}
      </div>

      {form.action === 'set_promo_video' ? (
        <Input label="YouTube URL of the published video" value={form.youtubeUrl} disabled={!canEdit} placeholder="https://www.youtube.com/watch?v=…" onChange={(e) => setForm({ ...form, youtubeUrl: e.target.value })} />
      ) : choices.length === 0 ? (
        <p className="text-2xs text-fg-faint">
          {form.action === 'upload_app_preview'
            ? 'No store-ready video in the kit: an app preview is an .mp4 or .mov (render one with your video tool and add it as the product video).'
            : 'No PNG or JPEG screenshots in the kit yet.'}
        </p>
      ) : (
        <fieldset className="space-y-1">
          <legend className="text-2xs text-fg-muted">Files to upload</legend>
          <ul role="list" className="grid grid-cols-1 gap-1 sm:grid-cols-2">
            {choices.map((a) => {
              const checked = form.assetIds.includes(a.id)
              return (
                <li key={a.id} className="flex items-start gap-2 rounded-sm border border-edge-subtle p-1.5">
                  {a.url && a.mime.startsWith('image/') && <img src={a.url} alt="" className="h-12 w-8 shrink-0 rounded-sm object-cover" />}
                  <div className="min-w-0 space-y-0.5">
                    <Checkbox
                      label={`${KIND_LABEL[a.kind]} · ${a.label ?? a.storage_path.split('/').pop()}`}
                      checked={checked}
                      disabled={!canEdit}
                      onChange={(next: boolean) => setForm({ ...form, assetIds: next ? [...form.assetIds, a.id] : form.assetIds.filter((x) => x !== a.id) })}
                    />
                    <AssetChecks asset={a} />
                  </div>
                </li>
              )
            })}
          </ul>
          {form.action === 'upload_listing_images' && (
            <Checkbox label="Replace the images of this type for this language" checked={form.replace} disabled={!canEdit} onChange={(next: boolean) => setForm({ ...form, replace: next })} />
          )}
        </fieldset>
      )}

      {problem && (
        <Callout tone="danger">
          <span role="status">{problem}</span>
        </Callout>
      )}
      <Btn size="sm" loading={busy} disabled={!canAsk} title={canEdit ? 'Ask for approval; nothing uploads before a person approves it' : 'Viewers cannot ask for store uploads.'} onClick={() => void ask()}>
        Ask for approval
      </Btn>
    </div>
  )
}
