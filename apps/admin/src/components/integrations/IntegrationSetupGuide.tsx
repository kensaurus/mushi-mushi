/**
 * Numbered credential setup steps for platform / routing integration cards.
 * Mirrors the pattern in ByokPanel — console link + ordered steps.
 */

import { IconExternalLink } from '../icons'

interface Props {
  label: string
  steps: string[]
  consoleUrl?: string
  consoleLabel?: string
  /** When true, use compact styling inside the edit form. */
  compact?: boolean
}

export function IntegrationSetupGuide({
  label,
  steps,
  consoleUrl,
  consoleLabel,
  compact = false,
}: Props) {
  if (steps.length === 0) return null

  return (
    <div
      className={
        compact
          ? 'rounded-sm border border-brand/15 bg-brand/5 px-2.5 py-2'
          : 'mt-2 rounded-sm border border-edge-subtle bg-surface-overlay px-2.5 py-2'
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
        <p className="text-2xs font-medium text-fg-secondary">
          How to connect {label}
        </p>
        {consoleUrl && (
          <a
            href={consoleUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 text-2xs text-accent-foreground hover:text-accent underline underline-offset-2"
          >
            {consoleLabel ?? 'Open console'}
            <IconExternalLink size={10} />
          </a>
        )}
      </div>
      <ol className="list-decimal list-inside space-y-1 text-2xs text-fg-muted leading-snug">
        {steps.map((step, i) => (
          <li key={i}>{step}</li>
        ))}
      </ol>
    </div>
  )
}
