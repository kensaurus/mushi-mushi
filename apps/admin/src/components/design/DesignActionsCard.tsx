/**
 * FILE: apps/admin/src/components/design/DesignActionsCard.tsx
 * PURPOSE: What the deviance score may do on its own, per project and off by
 *          default: fail `mushi recipe check --push` in the host's CI above a
 *          threshold, and dispatch a fix for new design drift above it (the
 *          normal automatic dispatch, so Autofix and its caps still apply).
 *          Owners and admins change it; everyone else reads it. Owners and
 *          admins can also send the newest scan's existing findings to an
 *          agent (one report per file, a few files at a time, never a
 *          token-definition file), since the auto-fix only acts on new ones.
 *
 * Data: GET|PUT /v1/admin/projects/:id/design/settings → DesignActionSettingsView
 *       POST /v1/admin/projects/:id/design/dispatch-findings → DesignFindingsDispatchResult
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Btn, Callout, ErrorAlert, Loading, Section, Toggle } from '../ui'
import { ConfirmDialog } from '../ConfirmDialog'
import { usePageData } from '../../lib/usePageData'
import { apiFetchMutate } from '../../lib/supabase'
import type { DesignActionSettingsView, DesignFindingsDispatchResult } from '../../lib/recipeTypes'

/** Files sent per click; the server allows 1–20. */
const FILES_PER_SEND = 5

/** One plain sentence for what a send did. */
function describeFindingsDispatch(r: DesignFindingsDispatchResult): string {
  if (r.action === 'no_scan') return 'There is no finished scan yet. Run a scan first.'
  if (r.action === 'budget_reached') return `Nothing sent: ${r.reason ?? "the app's auto-fix limits are reached for today"}`
  const sent = r.sent ?? []
  const left = r.remainingFiles ?? 0
  const tokenFiles = r.skipped?.tokenDefinition ?? 0
  const skippedNote = tokenFiles > 0 ? ` ${tokenFiles} finding${tokenFiles === 1 ? '' : 's'} in token files were left out.` : ''
  if (sent.length === 0) return `Nothing to send: every file with findings already has an open report.${skippedNote}`
  const refused = sent.filter((s) => s.refused)
  const queued = sent.length - refused.length
  const parts = [`Sent ${queued} file${queued === 1 ? '' : 's'} to the agent.`]
  if (refused.length > 0) parts.push(`${refused.length} not dispatched: ${refused[0].refused?.message ?? 'refused'}.`)
  if (left > 0) parts.push(`${left} more file${left === 1 ? '' : 's'} left.`)
  return parts.join(' ') + skippedNote
}

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

  const [confirmSend, setConfirmSend] = useState(false)
  const sendFindings = async () => {
    setBusy(true)
    setNotice(null)
    try {
      const res = await apiFetchMutate<DesignFindingsDispatchResult>(`/v1/admin/projects/${projectId}/design/dispatch-findings`, {
        method: 'POST',
        body: JSON.stringify({ maxFiles: FILES_PER_SEND }),
      })
      if (!res.ok || !res.data) setNotice({ tone: 'danger', text: res.error?.message ?? 'The findings could not be sent.' })
      else setNotice({ tone: 'ok', text: describeFindingsDispatch(res.data) })
    } finally {
      setBusy(false)
      setConfirmSend(false)
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
            {data.canEdit && (
              <div className="flex flex-wrap items-center gap-2">
                <Btn
                  size="sm"
                  variant="ghost"
                  type="button"
                  onClick={() => setConfirmSend(true)}
                  disabled={busy || !data.autofixEnabled}
                  title={data.autofixEnabled ? 'Send the latest scan\'s findings to an agent' : 'Turn on Autofix first'}
                >
                  Send findings to agent
                </Btn>
                <span className="text-2xs text-fg-muted">
                  The latest scan&apos;s findings, one report per file, {FILES_PER_SEND} files at a time. Token files are never sent.
                </span>
              </div>
            )}
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
        {confirmSend && (
          <ConfirmDialog
            title="Send design findings to an agent?"
            body={`Mushi opens one report for each of up to ${FILES_PER_SEND} files from the latest scan and dispatches a fix for each. Autofix's spend and per-day caps apply.`}
            confirmLabel="Send findings"
            loading={busy}
            onConfirm={sendFindings}
            onCancel={() => setConfirmSend(false)}
          />
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
