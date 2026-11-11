'use client'

/**
 * The hero's primary action since ADR 0056: "Check your live app free". An
 * address box that starts the free Production Check in place (no sign-up,
 * nothing to install) and then opens its report on /check, which polls it.
 *
 * It starts the check on submit rather than linking to a pre-filled /check
 * form, so a visitor presses one button, not two. /check itself only pre-fills
 * from a link (`urlFromSearch`) so a bot or link preview never spends a check;
 * this box spends one only on a person's submit.
 */
import { useState, type FormEvent } from 'react'
import { LANDING_CHECK, normalizeCheckUrl } from '@/lib/landing-copy'
import { startCheck } from '@/lib/production-check'
import { publicAssetPath } from '@/lib/public-asset-path'

export function LandingCheckBox() {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const raw = String(new FormData(e.currentTarget).get('url') ?? '')
    const url = normalizeCheckUrl(raw)
    if (!url) {
      setError(LANDING_CHECK.emptyError)
      return
    }
    setError(null)
    setBusy(true)
    const r = await startCheck({ url, src: LANDING_CHECK.src })
    if (!r.ok) {
      setBusy(false)
      setError(r.message)
      return
    }
    // A full load: /check reads the report id from the address on mount.
    window.location.assign(publicAssetPath(`/check?id=${encodeURIComponent(r.data.id)}`))
  }

  return (
    <form className="landing-check-box" onSubmit={onSubmit} noValidate aria-labelledby="landing-check-heading">
      <h2 id="landing-check-heading" className="landing-check-box__heading">
        {LANDING_CHECK.heading}
      </h2>
      <label htmlFor="landing-check-url" className="sr-only">
        {LANDING_CHECK.inputLabel}
      </label>
      <div className="landing-check-box__row">
        <input
          id="landing-check-url"
          name="url"
          type="text"
          inputMode="url"
          autoComplete="url"
          autoCapitalize="none"
          spellCheck={false}
          placeholder={LANDING_CHECK.placeholder}
          className="landing-check-box__input"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'landing-check-error' : 'landing-check-note'}
        />
        <button
          type="submit"
          className="landing-check-box__button"
          disabled={busy}
          data-mushi-cta={LANDING_CHECK.id}
          data-mushi-location="hero"
        >
          {busy ? 'Starting…' : LANDING_CHECK.button}
        </button>
      </div>
      {error ? (
        <p id="landing-check-error" role="alert" className="landing-check-box__error">
          {error}
        </p>
      ) : (
        <p id="landing-check-note" className="landing-check-box__note">
          {LANDING_CHECK.note}
        </p>
      )}
    </form>
  )
}
