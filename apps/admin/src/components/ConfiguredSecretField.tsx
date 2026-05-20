/**
 * Secret key / token field: shows a masked "configured" value when a secret
 * exists server-side, plus a separate rotate input — never a blank value area.
 */

import { Input } from './ui'
import { ConfigHelp } from './ConfigHelp'

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

interface ConfiguredSecretFieldProps {
  label: string
  helpId?: string
  configured: boolean
  /** Server-persisted masked hint, e.g. sk-ant-api…x4f2 */
  keyHint?: string | null
  /** Prefix when no hint yet (vault ref, legacy row, first paint after save) */
  fallbackPrefix?: string
  value: string
  onChange: (value: string) => void
  placeholder: string
  rotatePlaceholder?: string
  autoComplete?: string
  /** Override the green pill — default "In Vault" */
  configuredLabel?: string
}

export function ConfiguredSecretField({
  label,
  helpId,
  configured,
  keyHint,
  fallbackPrefix,
  value,
  onChange,
  placeholder,
  rotatePlaceholder = 'Paste new value to rotate…',
  autoComplete = 'new-password',
  configuredLabel = 'In Vault',
}: ConfiguredSecretFieldProps) {
  const hasDraft = value.trim().length > 0
  const showConfigured = configured && !hasDraft
  const masked = formatConfiguredKeyHint(keyHint, fallbackPrefix)

  return (
    <div className="space-y-1.5">
      <span className="text-2xs text-fg-muted flex items-center gap-1">
        {label}
        {helpId && <ConfigHelp helpId={helpId} />}
      </span>

      {showConfigured && (
        <div
          className="flex items-center justify-between gap-2 rounded-sm border border-ok/30 bg-ok/5 px-2.5 py-2 min-h-[2.25rem]"
          aria-label={`${label} configured`}
        >
          <code className="text-xs font-mono text-fg-secondary tracking-wide truncate select-all">
            {masked}
          </code>
          <span className="shrink-0 text-2xs font-medium text-ok">{configuredLabel}</span>
        </div>
      )}

      {configured ? (
        <div className="space-y-1">
          {showConfigured && (
            <span className="text-2xs text-fg-faint">Rotate</span>
          )}
          <Input
            type="password"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={rotatePlaceholder}
            autoComplete={autoComplete}
          />
        </div>
      ) : (
        <Input
          type="password"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
        />
      )}
    </div>
  )
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
