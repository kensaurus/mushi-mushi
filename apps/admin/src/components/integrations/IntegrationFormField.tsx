/**
 * Password / secret field renderer for integration edit forms.
 */

import type { PlatformFieldDef } from './types'
import { ConfiguredSecretField } from '../ConfiguredSecretField'
import { Input } from '../ui'
import { ConfigHelp } from '../ConfigHelp'
import { resolveValidator } from '../../lib/validators'
import { InlineProof } from '../report-detail/ReportSurface'
import {
  isSecretConfigured,
  normalizeSecretHint,
  secretFallbackPrefix,
} from '../../lib/secretFieldMeta'

interface IntegrationSecretFieldProps {
  field: PlatformFieldDef
  savedConfig: Record<string, unknown>
  value: string
  onChange: (value: string) => void
}

export function IntegrationSecretField({
  field,
  savedConfig,
  value,
  onChange,
}: IntegrationSecretFieldProps) {
  const savedRaw = savedConfig[field.name]
  const configured = isSecretConfigured(savedRaw)
  const keyHint = normalizeSecretHint(savedRaw, field.name)

  return (
    <ConfiguredSecretField
      label={field.label}
      helpId={field.helpId}
      configured={configured}
      keyHint={keyHint}
      fallbackPrefix={secretFallbackPrefix(field.name)}
      value={value}
      onChange={onChange}
      placeholder={field.placeholder}
      configuredLabel="Configured"
    />
  )
}

interface IntegrationFormFieldProps {
  field: PlatformFieldDef
  savedConfig: Record<string, unknown>
  value: string
  onChange: (value: string) => void
}

export function IntegrationFormField({
  field,
  savedConfig,
  value,
  onChange,
}: IntegrationFormFieldProps) {
  if (field.type === 'password') {
    return (
      <div>
        <IntegrationSecretField
          field={field}
          savedConfig={savedConfig}
          value={value}
          onChange={onChange}
        />
        {field.help ? <InlineProof className="mt-1">{field.help}</InlineProof> : null}
      </div>
    )
  }

  return (
    <div>
      <label className="text-2xs text-fg-muted mb-0.5 flex items-center gap-1">
        <span>
          {field.label}
          {field.required && <span className="text-danger ml-0.5">*</span>}
        </span>
        {field.helpId && <ConfigHelp helpId={field.helpId} />}
      </label>
      <Input
        type={field.type ?? 'text'}
        placeholder={field.placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        validate={resolveValidator(field.validator)}
      />
      {field.help ? <InlineProof className="mt-1">{field.help}</InlineProof> : null}
    </div>
  )
}
