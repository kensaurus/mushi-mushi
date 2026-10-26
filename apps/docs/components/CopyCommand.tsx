'use client'

/**
 * One command with a Copy button. Shared by the landing hero, the
 * three-step start strip and the quickstart framework picker, so every
 * command a newcomer is asked to run is one click away from the clipboard.
 */
import { useState } from 'react'

interface CopyCommandProps {
  cmd: string
  /** Small caption above the command. */
  label?: string
  /** `cta_click.cta_id` for <MushiSiteAnalytics />. */
  ctaId?: string
  location?: string
}

export function CopyCommand({ cmd, label, ctaId, location }: CopyCommandProps) {
  const [copied, setCopied] = useState(false)
  function copy() {
    void navigator.clipboard?.writeText(cmd).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }
  const tracking = ctaId ? { 'data-mushi-cta': ctaId, 'data-mushi-location': location } : {}
  return (
    <div className="landing-oneclick__cmd">
      {label ? <span className="landing-oneclick__cmd-label">{label}</span> : null}
      <div className="landing-oneclick__cmd-row">
        <span className="landing-oneclick__prompt" aria-hidden="true">
          $
        </span>
        <code>{cmd}</code>
        <button
          type="button"
          onClick={copy}
          className="landing-oneclick__copy"
          aria-label={copied ? 'Copied to clipboard' : `Copy: ${cmd}`}
          {...tracking}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  )
}
