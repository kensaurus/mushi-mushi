/**
 * Secret key / token field: shows a masked "configured" value when a secret
 * exists server-side, plus a separate rotate input — never a blank value area.
 */

/** Build a display-safe masked key from server hint or provider prefix. */
export function formatConfiguredKeyHint(
  hint: string | null | undefined,
  fallbackPrefix?: string,
): string {
  const h = (hint ?? '').trim()
  if (h) return h
  if (fallbackPrefix) return `${fallbackPrefix}••••••••••••`
  return '••••••••••••••••'
}

export function maskSecret(value: string | null | undefined): string {
  const v = (value ?? '').trim()
  if (!v) return '(empty)'
  if (v.length <= 8) return '••••••••'
  return `${v.slice(0, 4)}…${v.slice(-4)}`
}

/** Compact read-only chip for credential summaries (integration cards, lists). */
export function ConfiguredSecretChip({
  label,
  hint,
  fallbackPrefix,
}: {
  label: string
  hint?: string | null
  fallbackPrefix?: string
}) {
  return (
    <span
      className="inline-flex max-w-full items-center gap-1.5 rounded-sm border border-ok/25 bg-ok/5 px-1.5 py-0.5 text-2xs"
      title={`${label} configured`}
    >
      <span className="text-fg-muted shrink-0">{label}</span>
      <code className="font-mono text-fg-secondary truncate">
        {formatConfiguredKeyHint(hint, fallbackPrefix)}
      </code>
    </span>
  )
}
