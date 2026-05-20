/**
 * Read-only credential chips for configured integration secret fields.
 */

import type { PlatformFieldDef } from './types'
import { ConfiguredSecretChip } from '../ConfiguredSecretField'
import {
  isSecretConfigured,
  normalizeSecretHint,
  secretFallbackPrefix,
} from '../../lib/secretFieldMeta'

export function IntegrationCredentialChips({
  fields,
  config,
}: {
  fields: PlatformFieldDef[]
  config: Record<string, unknown>
}) {
  const secrets = fields.filter(
    (f) => f.type === 'password' && isSecretConfigured(config[f.name]),
  )
  if (secrets.length === 0) return null

  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {secrets.map((f) => (
        <ConfiguredSecretChip
          key={f.name}
          label={f.label}
          hint={normalizeSecretHint(config[f.name], f.name)}
          fallbackPrefix={secretFallbackPrefix(f.name)}
        />
      ))}
    </div>
  )
}
