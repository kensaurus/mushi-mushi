/**
 * FILE: apps/admin/src/components/settings/ClaudeModelSelect.tsx
 * PURPOSE: The model picker for every Claude job in Settings (quick check,
 *          diagnosis, judge, fix, PR review). Lists the models the app's own
 *          Anthropic key can use (GET /v1/admin/byok/anthropic/models) merged
 *          with the built-in catalog (lib/claudeModels.ts), so a new model
 *          appears without a release (ADR 0039). A saved model that is in
 *          neither list stays visible as "(saved)" instead of the picker
 *          silently showing another one. Under the picker: the recommended
 *          model for this job with its reason and sources, and two buttons,
 *          "Use recommended" and "Reset to default".
 */

import type { ReactNode } from 'react'
import { usePageData } from '../../lib/usePageData'
import {
  ROLE_DEFAULTS,
  effectiveModelId,
  ROLE_RECOMMENDED,
  modelLabel,
  modelOptions,
  type LiveModel,
  type ModelRole,
} from '../../lib/claudeModels'
import { Btn, SelectField } from '../ui'

interface LiveModels {
  source: 'live' | 'none' | 'error'
  models: LiveModel[]
  message?: string
}

const GROUP_LABEL = {
  saved: 'Saved for this app',
  current: 'Current Claude models',
  older: 'Older Claude models (still served)',
} as const

export function ClaudeModelSelect({
  role,
  value,
  onChange,
  label = 'Model',
  helpId,
  extraOptions,
}: {
  role: ModelRole
  /** The saved or edited value; empty means the server default. */
  value: string | null | undefined
  onChange: (id: string) => void
  label?: string
  helpId?: string
  /** Extra non-Claude options (an OpenAI fallback group), rendered last. */
  extraOptions?: ReactNode
}) {
  const live = usePageData<LiveModels>('/v1/admin/byok/anthropic/models')
  const fallback = ROLE_DEFAULTS[role]
  const current = effectiveModelId(value, role)
  const options = modelOptions(live.data?.models ?? [], current)
  const rec = ROLE_RECOMMENDED[role]
  const groups = (['saved', 'current', 'older'] as const).filter((g) => options.some((o) => o.group === g))

  return (
    <div className="flex flex-col gap-1.5" data-testid={`model-select-${role}`}>
      <SelectField label={label} helpId={helpId} value={current} onChange={(e) => onChange(e.target.value)}>
        {groups.map((g) => (
          <optgroup key={g} label={GROUP_LABEL[g]}>
            {options
              .filter((o) => o.group === g)
              .map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                  {o.id === rec.id ? ' · recommended' : ''}
                  {o.id === fallback ? ' · default' : ''}
                </option>
              ))}
          </optgroup>
        ))}
        {extraOptions}
      </SelectField>
      <div className="rounded-md border border-edge-subtle bg-surface-overlay/40 px-2.5 py-2 text-2xs text-fg-secondary">
        <p>
          <span className="font-semibold text-fg">Recommended: {modelLabel(rec.id)}.</span> {rec.why}
        </p>
        <p className="mt-1 text-fg-muted">
          Sources:{' '}
          {rec.sources.map((s, i) => (
            <span key={s.href}>
              {i > 0 && ' · '}
              <a href={s.href} target="_blank" rel="noreferrer" className="underline decoration-dotted hover:text-fg">
                {s.label}
              </a>
            </span>
          ))}{' '}
          (read {rec.sources[0]?.checked})
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <Btn
            size="sm"
            variant="ghost"
            onClick={() => onChange(rec.id)}
            disabled={current === rec.id}
            data-testid={`model-use-recommended-${role}`}
          >
            {current === rec.id ? 'Using the recommended model' : `Use ${modelLabel(rec.id)}`}
          </Btn>
          <Btn
            size="sm"
            variant="ghost"
            onClick={() => onChange(fallback)}
            disabled={current === fallback}
            data-testid={`model-reset-${role}`}
          >
            {current === fallback ? `Default (${modelLabel(fallback)})` : `Reset to default (${modelLabel(fallback)})`}
          </Btn>
          {live.data?.source === 'live' && (
            <span className="text-fg-muted">Model list read from your Anthropic key.</span>
          )}
          {live.data?.source === 'none' && (
            <span className="text-fg-muted">No Anthropic key for this app yet: showing Mushi&apos;s built-in list.</span>
          )}
          {live.data?.source === 'error' && (
            <span className="text-fg-muted">Anthropic&apos;s model list did not load: showing Mushi&apos;s built-in list.</span>
          )}
        </div>
      </div>
    </div>
  )
}
