/**
 * BYOK / secret key field: shows a masked "configured" value when a key
 * exists in Vault, plus a separate rotate input — never an empty value area.
 */

import { Input } from '../ui'
import { ConfigHelp } from '../ConfigHelp'

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

interface ConfiguredSecretFieldProps {
  label: string
  helpId?: string
  configured: boolean
  /** Server-persisted masked hint, e.g. sk-ant-api…x4f2 */
  keyHint?: string | null
  /** Prefix when no hint yet (first paint after save, before reload) */
  fallbackPrefix?: string
  value: string
  onChange: (value: string) => void
  placeholder: string
  rotatePlaceholder?: string
  autoComplete?: string
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
  rotatePlaceholder = 'Paste new key to rotate…',
  autoComplete = 'new-password',
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
          <span className="shrink-0 text-2xs font-medium text-ok">In Vault</span>
        </div>
      )}

      {configured ? (
        <div className="space-y-1">
          {showConfigured && (
            <span className="text-2xs text-fg-faint">Rotate key</span>
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
