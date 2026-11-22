/**
 * FILE: apps/admin/src/components/providers/ChainDrawer.tsx
 * PURPOSE: Edit one fallback order (a chain) in a side drawer, for every feature that shares it.
 *          Reorder steps (↑/↓), switch a step's model (priced models of its provider, with input
 *          and output price per 1M and the size class), set its effort (reasoning effort on OpenAI and
 *          OpenRouter, effort on Anthropic; picking Sol moves none to low, which Sol needs), turn a
 *          step on or off, remove one, add one.
 *          "Review" shows the order before and after and the change in plain words; "Save" is a
 *          second, explicit press. The page sends the writes (ProvidersPage onSaveChain).
 */

import { useMemo, useState } from 'react'
import type { ModelPrice, OpsMeta, RouteParams } from '../../lib/kensaurusOpsTypes'
import { paramChips, paramChoices, paramFieldsFor } from '../../lib/providersView'
import {
  chainTitle,
  paramsForModel,
  paramsProblem,
  draftChanges,
  draftFrom,
  draftProblem,
  modelShort,
  moveStep,
  priceBook,
  priceLabel,
  providerName,
  type ChainStep,
  type DraftStep,
  type ProviderHealth,
  type RouteChain,
} from '../../lib/routeChains'
import { Drawer } from '../Drawer'
import { Btn, Toggle } from '../ui'
import { IconTrash } from '../icons'
import { Chip } from '../signal/Chip'
import { StatusMark } from '../signal/StatusMark'
import { healthStatus } from './RoutesOverview'

const ICON_BTN =
  'inline-flex h-7 w-7 items-center justify-center rounded-sm border border-edge-subtle bg-surface-raised text-xs font-bold text-fg-secondary ' +
  'hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand'
const SELECT =
  'min-w-0 rounded-sm border border-edge-subtle bg-surface-raised px-1.5 py-1 text-xs text-fg disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand'

/** The params a provider takes, from meta, for a new step. */
function ParamsFields({ meta, provider, value, onChange }: { meta: OpsMeta | null; provider: string; value: RouteParams; onChange: (p: RouteParams) => void }) {
  const fields = paramFieldsFor(meta, provider)
  const set = (k: string, v: unknown) => {
    const next = { ...value }
    if (v === '' || v == null) delete next[k]
    else next[k] = v
    onChange(next)
  }
  if (fields.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5" data-testid="route-params-fields">
      {fields.map((k) => {
        if (k === 'thinking') {
          const spec = meta?.route_params?.thinking as { type?: unknown } | undefined
          const types = Array.isArray(spec?.type) ? (spec.type as string[]) : []
          const t = value.thinking
          return (
            <span key={k} className="inline-flex items-center gap-1">
              <select
                aria-label="thinking"
                className={SELECT}
                value={t?.type ?? ''}
                onChange={(e) => set('thinking', e.target.value ? { type: e.target.value, ...(t?.budget_tokens ? { budget_tokens: t.budget_tokens } : {}) } : null)}
              >
                <option value="">thinking</option>
                {types.map((x) => (
                  <option key={x} value={x}>
                    {x}
                  </option>
                ))}
              </select>
              {t?.type === 'enabled' && (
                <input
                  aria-label="thinking budget_tokens"
                  className={`${SELECT} w-20`}
                  inputMode="numeric"
                  placeholder="budget"
                  value={t.budget_tokens ?? ''}
                  onChange={(e) => set('thinking', { type: 'enabled', ...(e.target.value ? { budget_tokens: Number(e.target.value) } : {}) })}
                />
              )}
            </span>
          )
        }
        const choices = paramChoices(meta, k)
        if (choices) {
          return (
            <select key={k} aria-label={k} className={SELECT} value={String(value[k] ?? '')} onChange={(e) => set(k, e.target.value)}>
              <option value="">{k}</option>
              {choices.map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </select>
          )
        }
        const numeric = k === 'max_output_tokens' || k === 'temperature'
        return (
          <input
            key={k}
            aria-label={k}
            className={`${SELECT} w-28`}
            placeholder={k}
            inputMode={numeric ? 'decimal' : undefined}
            value={value[k] == null ? '' : String(value[k])}
            onChange={(e) => set(k, numeric ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value)}
          />
        )
      })}
    </div>
  )
}

/** The model picker of one provider: priced models only, with prices; an unpriced current model stays shown. */
function ModelSelect({
  provider,
  value,
  prices,
  now,
  label,
  onChange,
  disabled,
}: {
  provider: string
  value: string
  prices: readonly ModelPrice[]
  now: number
  label: string
  onChange: (model: string) => void
  disabled?: boolean
}) {
  const book = useMemo(() => priceBook(prices, provider, now), [prices, provider, now])
  const priced = book.some((p) => p.model === value)
  if (book.length === 0 && !value) return <span className="text-2xs text-warn-foreground">No priced model for {providerName(provider)}: add a price on kenji first</span>
  return (
    <select aria-label={label} className={`${SELECT} w-full font-mono`} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} data-testid="step-model">
      {!priced && value && (
        <option value={value} disabled>
          {modelShort(value)} (no price)
        </option>
      )}
      {book.map((p) => (
        <option key={p.model} value={p.model}>
          {p.model} — {priceLabel(p)}
        </option>
      ))}
    </select>
  )
}

function stepPrice(prices: readonly ModelPrice[], s: { provider: string; model: string }, now: number): string | null {
  const p = priceBook(prices, s.provider, now).find((x) => x.model === s.model)
  return p ? priceLabel(p) : null
}

/** The effort key a provider reads, from meta: reasoning_effort (OpenAI, OpenRouter) or effort (Anthropic). */
function effortKey(meta: OpsMeta | null, provider: string): 'reasoning_effort' | 'effort' | null {
  const fields = paramFieldsFor(meta, provider)
  if (fields.includes('reasoning_effort')) return 'reasoning_effort'
  if (fields.includes('effort')) return 'effort'
  return null
}

/** The step's effort, beside its model: the setting a model switch most often needs. */
function EffortSelect({ meta, provider, value, label, onChange }: { meta: OpsMeta | null; provider: string; value: RouteParams; label: string; onChange: (p: RouteParams) => void }) {
  const key = effortKey(meta, provider)
  const choices = key ? paramChoices(meta, key) : null
  if (!key || !choices) return null
  const current = typeof value[key] === 'string' ? (value[key] as string) : ''
  return (
    <label className="flex items-center gap-1.5 text-2xs text-fg-secondary">
      <span>{key === 'reasoning_effort' ? 'Reasoning effort' : 'Effort'}</span>
      <select
        aria-label={label}
        className={SELECT}
        value={current}
        data-testid="step-effort"
        onChange={(e) => {
          const next = { ...value }
          if (e.target.value) next[key] = e.target.value
          else delete next[key]
          onChange(next)
        }}
      >
        <option value="">not set</option>
        {choices.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
    </label>
  )
}

/** One step in read-only form, for the before/after lists. */
function StepLine({ s, n, changed }: { s: ChainStep; n: number; changed?: boolean }) {
  return (
    <li className={`flex min-w-0 items-baseline gap-1.5 text-xs ${s.enabled ? '' : 'text-fg-muted line-through'} ${changed ? 'font-bold' : ''}`}>
      <span className="font-mono text-2xs text-fg-secondary tabular-nums">{n}.</span>
      <span className="shrink-0">{providerName(s.provider)}</span>
      <span className="min-w-0 truncate font-mono">{modelShort(s.model)}</span>
      {!s.enabled && <span className="text-2xs no-underline">(off)</span>}
    </li>
  )
}

export interface ChainDrawerProps {
  chain: RouteChain | null
  appName: (app: string) => string
  meta: OpsMeta | null
  prices: readonly ModelPrice[]
  health: ReadonlyMap<string, ProviderHealth>
  now: number
  /** Saving progress: features done of total; null when idle. */
  saving: { done: number; total: number } | null
  onClose: () => void
  onSave: (chain: RouteChain, draft: DraftStep[]) => void
}

let uidSeq = 0

/** Keyed by the chain id, so a different chain always starts from its own steps. */
export function ChainDrawer(props: ChainDrawerProps) {
  return (
    <Drawer
      open={!!props.chain}
      onClose={props.saving ? () => {} : props.onClose}
      dismissible={!props.saving}
      title={props.chain ? `${props.appName(props.chain.app)} · ${chainTitle(props.chain)}` : 'Fallback order'}
      width="lg"
    >
      {props.chain && <ChainEditor key={props.chain.id} {...props} chain={props.chain} />}
    </Drawer>
  )
}

function ChainEditor({ chain, meta, prices, health, now, saving, onClose, onSave }: ChainDrawerProps & { chain: RouteChain }) {
  const [draft, setDraft] = useState<Array<DraftStep & { uid: string }>>(() => draftFrom(chain).map((d, i) => ({ ...d, uid: `s${i}` })))
  const [review, setReview] = useState(false)
  const [adding, setAdding] = useState(false)
  const providers = meta?.route_providers ?? []
  const [newProvider, setNewProvider] = useState(providers[0] ?? '')
  const [newModel, setNewModel] = useState('')
  const [newParams, setNewParams] = useState<RouteParams>({})
  const changes = draftChanges(chain, draft)
  const problem = draftProblem(chain, draft, meta)
  const features = chain.members.map((m) => (m.feature === '*' ? 'default' : m.feature))
  const max = (meta?.priority.max ?? 9) - (meta?.priority.min ?? 1) + 1
  const writes = changes.length === 0 ? 0 : chain.members.length

  const update = (uid: string, patch: Partial<DraftStep>) => setDraft((d) => d.map((s) => (s.uid === uid ? { ...s, ...patch } : s)))
  // Why a step's effort moved by itself ("gpt-6.2-sol needs … so it is now low"), per step.
  const [effortNotes, setEffortNotes] = useState<Record<string, string>>({})
  const switchModel = (s: DraftStep & { uid: string }, model: string) => {
    const next = paramsForModel(s.provider, model, s.params)
    update(s.uid, { model, params: next.params })
    setEffortNotes((n) => {
      const rest = { ...n }
      if (next.note) rest[s.uid] = next.note
      else delete rest[s.uid]
      return rest
    })
  }
  const newBook = priceBook(prices, newProvider, now)
  const chosenNew = newBook.some((p) => p.model === newModel) ? newModel : (newBook[0]?.model ?? '')

  if (review) {
    return (
      <div className="flex flex-col gap-3 px-4 pt-3" data-testid="chain-review">
        <p className="text-xs text-fg-secondary">
          This changes the fallback order of {features.length === 1 ? '1 feature' : `all ${features.length} features`} below. The router picks it up within a minute.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <section aria-label="Before" className="rounded-md border border-edge-subtle p-2">
            <h3 className="mb-1 text-2xs font-bold tracking-wide text-fg-secondary uppercase">Before</h3>
            <ol className="flex list-none flex-col gap-0.5 p-0" data-testid="chain-before">
              {chain.steps.map((s, i) => (
                <StepLine key={i} s={s} n={i + 1} />
              ))}
            </ol>
          </section>
          <section aria-label="After" className="rounded-md border border-accent/50 p-2">
            <h3 className="mb-1 text-2xs font-bold tracking-wide text-fg-secondary uppercase">After</h3>
            <ol className="flex list-none flex-col gap-0.5 p-0" data-testid="chain-after">
              {draft.map((s, i) => {
                const o = s.origin != null ? chain.steps[s.origin] : null
                const changed = !o || o.model !== s.model || o.enabled !== s.enabled
                return <StepLine key={s.uid} s={s} n={i + 1} changed={changed} />
              })}
            </ol>
          </section>
        </div>
        <section aria-label="Changes">
          <h3 className="mb-1 text-2xs font-bold tracking-wide text-fg-secondary uppercase">Changes</h3>
          <ul className="flex list-disc flex-col gap-0.5 pl-4 text-xs text-fg" data-testid="chain-changes">
            {changes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </section>
        <p className="text-2xs text-fg-muted">
          Sent as one change per feature, one at a time; each is recorded on History. If one is refused, the save stops there and says which features changed.
        </p>
        <details className="text-2xs text-fg-secondary">
          <summary className="cursor-pointer">Features ({features.length})</summary>
          <p className="pt-1 font-mono break-words">{features.join(', ')}</p>
        </details>
        <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center justify-end gap-2 border-t border-edge-subtle bg-surface-root px-4 py-2.5">
          {saving && (
            <span role="status" className="mr-auto text-2xs text-fg-secondary tabular-nums" data-testid="chain-saving">
              Saving {saving.done} of {saving.total} features…
            </span>
          )}
          <Btn size="sm" variant="ghost" onClick={() => setReview(false)} disabled={!!saving}>
            Back
          </Btn>
          <Btn size="sm" variant="primary" loading={!!saving} disabled={!!problem || writes === 0} onClick={() => onSave(chain, draft)} data-testid="chain-save">
            Save to {features.length === 1 ? '1 feature' : `${features.length} features`}
          </Btn>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 px-4 pt-3" data-testid="chain-editor">
      <p className="text-xs text-fg-secondary">
        The router tries these in order and moves to the next when one fails. {chain.isDefault ? 'Every feature without its own order uses this one too.' : ''}
      </p>
      <details className="text-2xs text-fg-secondary">
        <summary className="cursor-pointer">
          Used by {features.length === 1 ? '1 feature' : `${features.length} features`}
        </summary>
        <p className="pt-1 font-mono break-words">{features.join(', ')}</p>
      </details>

      <ol className="flex list-none flex-col gap-2 p-0" aria-label="Fallback order, first tried first" data-testid="chain-steps">
        {draft.map((s, i) => {
          const h = health.get(s.provider)
          const label = `step ${i + 1}, ${providerName(s.provider)} ${modelShort(s.model)}`
          const ek = effortKey(meta, s.provider)
          // The effort has its own picker; the other settings stay as chips.
          const chips = paramChips((ek ? Object.fromEntries(Object.entries(s.params).filter(([k]) => k !== ek)) : s.params) as RouteParams)
          const problem = paramsProblem(s.provider, s.model, s.params)
          return (
            <li
              key={s.uid}
              className={`flex flex-col gap-1.5 rounded-md border border-edge-subtle bg-surface px-2 py-1.5 ${s.enabled ? '' : 'opacity-70'}`}
              data-testid={`step-${i}`}
              data-enabled={s.enabled ? 'true' : 'false'}
            >
              <div className="flex items-center gap-1.5">
                <span className="font-mono text-xs font-extrabold text-fg-secondary tabular-nums">{i + 1}</span>
                {h && <StatusMark status={healthStatus(h)} label={h.word} />}
                <span className="text-xs font-bold text-fg">{providerName(s.provider)}</span>
                {h?.killed && <Chip tone="danger">switched off</Chip>}
                {s.origin == null && <Chip tone="strong">new</Chip>}
                <span className="ml-auto flex items-center gap-1">
                  <button type="button" className={ICON_BTN} aria-label={`Move ${label} up`} title="Try earlier" disabled={i === 0} onClick={() => setDraft((d) => moveStep(d, i, -1) as typeof d)}>
                    ↑
                  </button>
                  <button
                    type="button"
                    className={ICON_BTN}
                    aria-label={`Move ${label} down`}
                    title="Try later"
                    disabled={i === draft.length - 1}
                    onClick={() => setDraft((d) => moveStep(d, i, 1) as typeof d)}
                  >
                    ↓
                  </button>
                  <Toggle ariaLabel={`${s.enabled ? 'Turn off' : 'Turn on'} ${label}`} checked={s.enabled} onChange={(next) => update(s.uid, { enabled: next })} />
                  <button
                    type="button"
                    className={`${ICON_BTN} hover:border-danger hover:text-danger`}
                    aria-label={`Remove ${label}`}
                    title="Remove"
                    onClick={() => setDraft((d) => d.filter((x) => x.uid !== s.uid))}
                  >
                    <IconTrash size={13} />
                  </button>
                </span>
              </div>
              <ModelSelect provider={s.provider} value={s.model} prices={prices} now={now} label={`Model for ${label}`} onChange={(model) => switchModel(s, model)} />
              <EffortSelect
                meta={meta}
                provider={s.provider}
                value={s.params}
                label={`Effort for ${label}`}
                onChange={(params) => {
                  update(s.uid, { params })
                  setEffortNotes((n) => {
                    const rest = { ...n }
                    delete rest[s.uid]
                    return rest
                  })
                }}
              />
              {effortNotes[s.uid] && !problem && (
                <p className="text-2xs text-fg-secondary" role="status" data-testid="step-effort-note">
                  {effortNotes[s.uid]}
                </p>
              )}
              {problem && (
                <p className="text-2xs font-semibold text-st-failed-ink" role="alert" data-testid="step-problem">
                  {problem}.
                </p>
              )}
              {chips.length > 0 && (
                <span className="flex flex-wrap gap-1" aria-label="Settings">
                  {chips.map((c) => (
                    <Chip key={c}>{c}</Chip>
                  ))}
                </span>
              )}
            </li>
          )
        })}
      </ol>

      {adding ? (
        <div className="flex flex-col gap-1.5 rounded-md border border-dashed border-edge p-2" data-testid="add-step">
          <div className="flex flex-wrap items-center gap-1.5">
            <select
              aria-label="Provider for the new step"
              className={SELECT}
              value={newProvider}
              onChange={(e) => {
                setNewProvider(e.target.value)
                setNewModel('')
                setNewParams({})
              }}
            >
              {providers.map((p) => (
                <option key={p} value={p}>
                  {providerName(p)}
                </option>
              ))}
            </select>
          </div>
          <ModelSelect provider={newProvider} value={chosenNew} prices={prices} now={now} label="Model for the new step" onChange={setNewModel} />
          <ParamsFields meta={meta} provider={newProvider} value={newParams} onChange={setNewParams} />
          <div className="flex justify-end gap-1.5">
            <Btn size="sm" variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Btn>
            <Btn
              size="sm"
              variant="primary"
              disabled={!chosenNew}
              onClick={() => {
                const fitted = paramsForModel(newProvider, chosenNew, newParams)
                setDraft((d) => [...d, { provider: newProvider, model: chosenNew, params: fitted.params, enabled: true, origin: null, uid: `n${++uidSeq}` }])
                setAdding(false)
                setNewParams({})
                setNewModel('')
              }}
              data-testid="add-step-confirm"
            >
              Add step
            </Btn>
          </div>
        </div>
      ) : (
        <div>
          <Btn size="sm" variant="ghost" onClick={() => setAdding(true)} disabled={draft.length >= max} data-testid="add-step-open">
            + Add a step
          </Btn>
        </div>
      )}
      {draft.some((s) => s.origin != null && stepPrice(prices, s, now) === null) && (
        <p className="text-2xs text-fg-muted">A model marked “no price” stays as it is; switch it to a priced one to change it.</p>
      )}

      <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center justify-end gap-2 border-t border-edge-subtle bg-surface-root px-4 py-2.5">
        <span className="mr-auto text-2xs text-fg-secondary" data-testid="chain-change-count" aria-live="polite">
          {problem ?? (changes.length === 0 ? 'No changes yet' : `${changes.length} change${changes.length === 1 ? '' : 's'}`)}
        </span>
        <Btn size="sm" variant="ghost" onClick={onClose}>
          Cancel
        </Btn>
        <Btn size="sm" variant="primary" disabled={changes.length === 0 || !!problem} onClick={() => setReview(true)} data-testid="chain-review-open">
          Review changes
        </Btn>
      </div>
    </div>
  )
}
