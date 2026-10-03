/**
 * FILE: apps/admin/src/components/design/DesignActionsCard.tsx
 * PURPOSE: What the deviance score may do on its own, per project and off by
 *          default: fail `mushi recipe check --push` in the host's CI above a
 *          threshold, and dispatch a fix for new design drift above it (the
 *          normal automatic dispatch, so Autofix and its caps still apply).
 *          Owners and admins change it; everyone else reads it.
 *
 * Data: GET|PUT /v1/admin/projects/:id/design/settings → DesignActionSettingsView
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Btn, Callout, ErrorAlert, Loading, Section, Toggle } from '../ui'
import { usePageData } from '../../lib/usePageData'
import { apiFetchMutate } from '../../lib/supabase'
import type { DesignActionSettingsView } from '../../lib/recipeTypes'

const FIELD_CLS =
  'w-20 rounded-sm border border-edge-subtle bg-surface px-2 py-1 text-xs text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40'

/** A whole number 0–100, or an error to show. */
function parseThreshold(raw: string): { ok: true; value: number } | { ok: false; error: string } {
  const t = raw.trim()
  if (!/^\d{1,3}$/.test(t) || Number(t) > 100) return { ok: false, error: 'The threshold is a whole number from 0 to 100.' }
  return { ok: true, value: Number(t) }
}

export function DesignActionsCard({ projectId, score }: { projectId: string; score: number | null }) {
  const path = `/v1/admin/projects/${projectId}/design/settings`
  const { data, loading, error, reload } = usePageData<DesignActionSettingsView>(path)
  const [draft, setDraft] = useState<{ base: number; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null)

  // The draft follows the server value until the user types.
  const text = data && draft?.base === data.threshold ? draft.text : String(data?.threshold ?? '')
  const parsed = parseThreshold(text)
  const dirty = data != null && parsed.ok && parsed.value !== data.threshold

  const save = async (patch: Partial<Pick<DesignActionSettingsView, 'threshold' | 'failCi' | 'autofix'>>) => {
    setBusy(true)
    setNotice(null)
    try {
      const res = await apiFetchMutate<DesignActionSettingsView>(path, { method: 'PUT', body: JSON.stringify(patch) })
      if (!res.ok) setNotice({ tone: 'danger', text: res.error?.message ?? 'The design settings could not be saved.' })
      else {
        setNotice({ tone: 'ok', text: 'Saved.' })
        setDraft(null)
      }
    } finally {
      setBusy(false)
      reload()
    }
  }

  const off = !data?.canEdit || busy
  const over = data && score !== null && score > data.threshold
  return (
    <Section title="When the score is too high">
      <div className="flex flex-col gap-3">
        <p className="text-xs text-fg-secondary">
          Off by default. Above the threshold, Mushi can fail your CI check and dispatch a fix for drift that is new since the last scan.
        </p>
        {error && <ErrorAlert message={error} endpoint={path} onRetry={reload} />}
        {loading && !data && <Loading text="Reading design settings…" />}
        {data && (
          <>
            {!data.canEdit && <p className="text-xs text-fg-muted">Read-only: only project owners and admins change these.</p>}
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1 text-xs text-fg-secondary">
                Threshold (0–100)
                <input
                  className={FIELD_CLS}
                  inputMode="numeric"
                  value={text}
                  disabled={off}
                  aria-invalid={!parsed.ok}
                  onChange={(e) => setDraft({ base: data.threshold, text: e.target.value })}
                />
              </label>
              <Btn
                size="sm"
                variant="ghost"
                type="button"
                onClick={() => parsed.ok && void save({ threshold: parsed.value })}
                disabled={off || !dirty}
                loading={busy}
                title={dirty ? 'Save the threshold' : 'Change the threshold first'}
              >
                Save threshold
              </Btn>
              {score !== null && (
                <span className={`text-2xs ${over ? 'text-warn' : 'text-fg-muted'}`}>
                  Latest score {score}{over ? ', above the threshold' : ''}
                </span>
              )}
            </div>
            {!parsed.ok && <p className="text-2xs text-danger">{parsed.error}</p>}
            <div className="flex flex-col gap-2">
              <Toggle
                label="Fail mushi recipe check --push above the threshold"
                ariaLabel="Fail the CI check above the threshold"
                checked={data.failCi}
                disabled={off}
                onChange={(v) => void save({ failCi: v })}
              />
              <Toggle
                label="Dispatch a fix for new drift above the threshold"
                ariaLabel="Dispatch a fix for new design drift above the threshold"
                checked={data.autofix}
                disabled={off}
                onChange={(v) => void save({ autofix: v })}
              />
              <p className="text-2xs text-fg-muted">
                A CI push sets the shown score and may dispatch only with a CLI key from{' '}
                <code className="font-mono">mushi login</code>. A push with the SDK key keeps its findings and
                the CI check, because that key ships inside your app.
              </p>
            </div>
            {data.autofix && !data.autofixEnabled && (
              <Callout tone="warn" label="Autofix is off for this project">
                <p className="text-xs text-fg-secondary">
                  Nothing will be dispatched until Autofix is on. Turn it on under{' '}
                  <Link to="/integrations/config" className="text-brand underline-offset-2 hover:underline">
                    Integrations
                  </Link>
                  ; its spend and per-day caps apply to design fixes too.
                </p>
              </Callout>
            )}
          </>
        )}
        {notice && (
          <Callout tone={notice.tone}>
            <span role="status">{notice.text}</span>
          </Callout>
        )}
      </div>
    </Section>
  )
}
