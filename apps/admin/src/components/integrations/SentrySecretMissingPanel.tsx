/**
 * FILE: apps/admin/src/components/integrations/SentrySecretMissingPanel.tsx
 * PURPOSE: The Sentry card's fix for "Sentry webhook secret not configured":
 *          Sentry IS sending alerts to this project's receive URL, and Mushi
 *          rejects every one because it has no secret to check the signature
 *          (glot.it: 215 dropped in 7 days, 2026-10-14).
 *
 * Two ways out, both on the card:
 *   1. Turn on automatic import. New issues arrive every 15 minutes with the
 *      token already saved; nothing changes in Sentry.
 *   2. Save the Client Secret. Sentry signs each alert with the Client
 *      Secret of the internal integration that sends it. Sentry makes that
 *      value, so Mushi cannot generate it: copy it from Sentry's Developer
 *      Settings and paste it into the webhook secret field.
 */

import { useState } from 'react'
import { apiFetchMutate } from '../../lib/supabase'
import { CHIP_TONE } from '../../lib/chipTone'
import { Btn, ErrorAlert } from '../ui'

interface Props {
  orgSlug: string | null
  autoImportOn: boolean
  canManage: boolean
  /** Opens the card's edit form, where the webhook secret field is. */
  onPasteSecret: () => void
  /** Called after automatic import was turned on. */
  onChanged: () => void
}

export function SentrySecretMissingPanel({ orgSlug, autoImportOn, canManage, onPasteSecret, onChanged }: Props) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [turnedOn, setTurnedOn] = useState(false)
  const developerSettings = orgSlug
    ? `https://${encodeURIComponent(orgSlug)}.sentry.io/settings/developer-settings/`
    : 'https://sentry.io/settings/developer-settings/'

  const turnOnImport = async () => {
    setSaving(true)
    setError(null)
    const res = await apiFetchMutate('/v1/admin/integrations/platform/sentry', {
      method: 'PUT',
      body: JSON.stringify({ sentry_auto_import: true }),
    })
    setSaving(false)
    if (!res.ok) {
      setError(res.error?.message ?? 'Could not turn on automatic import.')
      return
    }
    setTurnedOn(true)
    onChanged()
  }

  return (
    <div className={`mx-3 mb-2 rounded-sm px-3 py-2 text-2xs space-y-2 ${CHIP_TONE.warnSubtle}`} data-testid="mushi-sentry-secret-missing">
      <p className="leading-snug">
        <strong>Sentry alerts are being dropped.</strong> Sentry sends them to this app, but Mushi has no webhook
        secret to check them with, so it rejects each one.
      </p>
      {canManage ? (
        <ol className="list-decimal pl-4 space-y-1.5 leading-snug">
          <li>
            {autoImportOn || turnedOn ? (
              <span>Automatic import is on: new issues arrive every 15 minutes without the webhook.</span>
            ) : (
              <span className="inline-flex flex-wrap items-center gap-2">
                <span>Fastest, nothing to change in Sentry:</span>
                <Btn size="sm" onClick={() => void turnOnImport()} loading={saving}>
                  Turn on automatic import
                </Btn>
              </span>
            )}
          </li>
          <li>
            <span className="inline-flex flex-wrap items-center gap-2">
              <span>
                For alerts within seconds, copy the <strong>Client Secret</strong> of the integration that sends them
                (Sentry makes it; Mushi can’t):
              </span>
              <a href={developerSettings} target="_blank" rel="noreferrer noopener" className="font-semibold underline hover:no-underline">
                Open Sentry Developer Settings ↗
              </a>
              <Btn size="sm" variant="ghost" onClick={onPasteSecret}>
                Paste the secret
              </Btn>
            </span>
          </li>
        </ol>
      ) : (
        <p>Ask a team owner or admin to save the secret or turn on automatic import.</p>
      )}
      {error && <ErrorAlert title="Not saved" message={error} />}
    </div>
  )
}
