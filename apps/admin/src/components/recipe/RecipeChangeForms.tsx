/**
 * FILE: apps/admin/src/components/recipe/RecipeChangeForms.tsx
 * PURPOSE: The three edit forms of the recipe side panel's Change tab:
 *            • GatesForm  — budgets (metric → number) and cadence (gate → P1D)
 *            • EnvForm    — declared env NAMES and where each must be set;
 *                           there is no value input anywhere
 *            • RoutesForm — inventory.yaml as text
 *          Each builds whole-file edits (recipeChangeEdits.ts) and hands them
 *          to `onPreview`. Every edit after a preview throws the preview away,
 *          so a confirm can only send what the diff showed.
 */

import { useMemo, useState } from 'react'
import { Btn, Checkbox, ErrorAlert } from '../ui'
import type { RecipeChangeEdit, RecipeSourceFile } from '../../lib/recipeTypes'
import {
  buildEnvEdits,
  buildGatesEdits,
  buildRoutesEdits,
  ENV_EXAMPLE_PATH,
  envRowsFrom,
  gatesDraftFrom,
  INVENTORY_PATH,
  MANIFEST_PATH,
  newEnvRow,
  parseManifest,
  type BuiltEdits,
  type EnvRow,
  type GatesDraft,
} from './recipeChangeEdits'

const FIELD_BASE =
  'min-w-0 rounded-sm border border-edge-subtle bg-surface px-2 py-1 text-xs text-fg placeholder:text-fg-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 disabled:opacity-60'
const FIELD_CLS = `${FIELD_BASE} w-full`

export interface ChangeFormProps {
  files: RecipeSourceFile[]
  /** Inputs frozen: a request is in flight or a job is on screen. */
  locked: boolean
  previewing: boolean
  onPreview: (edits: RecipeChangeEdit[]) => void
  /** Called on every edit, so a held preview is discarded. */
  onEdit: () => void
}

function fileOf(files: readonly RecipeSourceFile[], path: string): RecipeSourceFile | null {
  return files.find((f) => f.path === path) ?? null
}

/** Why a file cannot be edited here, or null when it can. */
function blockedReason(file: RecipeSourceFile | null, path: string): string | null {
  if (!file) return `${path} was not read.`
  if (!file.writable) return file.reason ?? `${path} is not writable.`
  if (file.exists && file.content === null) return file.reason ?? `${path} cannot be shown here.`
  return null
}

function PreviewBar({ built, blocked, locked, previewing, onPreview }: { built: BuiltEdits; blocked: string | null; locked: boolean; previewing: boolean; onPreview: (edits: RecipeChangeEdit[]) => void }) {
  const reason = blocked
    ?? (!built.ok ? 'Fix the highlighted rows first.' : built.edits.length === 0 ? 'Change something first.' : locked ? 'Finish or discard the current change first.' : null)
  return (
    <div className="flex flex-col gap-2">
      {!built.ok && <ErrorAlert message={built.errors.join(' ')} />}
      <div className="flex flex-wrap items-center gap-2">
        <Btn
          size="sm"
          variant="primary"
          onClick={() => built.ok && onPreview(built.edits)}
          disabled={reason !== null}
          loading={previewing}
          title={reason ?? 'Preview the diff before opening a draft PR'}
        >
          Preview diff
        </Btn>
        {built.ok && built.edits.length > 0 && (
          <span className="text-2xs text-fg-muted">
            {built.edits.length} file{built.edits.length === 1 ? '' : 's'} would change
          </span>
        )}
      </div>
      {blocked && <p className="text-2xs text-fg-muted">Read-only: {blocked}</p>}
    </div>
  )
}

function RemoveBtn({ label, disabled, onClick }: { label: string; disabled: boolean; onClick: () => void }) {
  return (
    <Btn size="sm" variant="ghost" onClick={onClick} disabled={disabled} aria-label={label} title={label}>
      Remove
    </Btn>
  )
}

// ── gates ────────────────────────────────────────────────────────────────────

export function GatesForm({ files, locked, previewing, onPreview, onEdit }: ChangeFormProps) {
  const manifest = fileOf(files, MANIFEST_PATH)
  const parsed = useMemo(() => parseManifest(manifest?.content ?? null), [manifest?.content])
  const [draft, setDraft] = useState<GatesDraft>(() => (parsed.ok ? gatesDraftFrom(parsed.doc) : { budgets: [], cadence: [] }))
  const blocked = blockedReason(manifest, MANIFEST_PATH) ?? (parsed.ok ? null : parsed.error)
  const off = blocked !== null || locked
  const built = useMemo(() => buildGatesEdits(files, draft), [files, draft])
  const set = (next: GatesDraft) => {
    setDraft(next)
    onEdit()
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-fg-secondary">
        Budgets fail the <span className="font-mono">code_health</span> gate when a metric goes over its number. Cadence says how often a
        gate must run before Mushi calls it stale.
      </p>
      <fieldset className="flex flex-col gap-1.5" disabled={off}>
        <legend className="text-xs font-medium text-fg-secondary">Budgets</legend>
        {draft.budgets.length === 0 && <p className="text-2xs text-fg-muted">No budgets yet.</p>}
        {draft.budgets.map((row, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <input
              className={`${FIELD_BASE} flex-1 font-mono`}
              value={row.metric}
              placeholder="bundle.web.gzip_kb"
              aria-label={`Budget ${i + 1} metric`}
              onChange={(e) => set({ ...draft, budgets: draft.budgets.map((r, j) => (j === i ? { ...r, metric: e.target.value } : r)) })}
            />
            <input
              className={`${FIELD_BASE} w-24 shrink-0 tabular-nums`}
              inputMode="decimal"
              value={row.limit}
              placeholder="300"
              aria-label={`Budget ${i + 1} limit`}
              onChange={(e) => set({ ...draft, budgets: draft.budgets.map((r, j) => (j === i ? { ...r, limit: e.target.value } : r)) })}
            />
            <RemoveBtn label={`Remove budget ${row.metric || i + 1}`} disabled={off} onClick={() => set({ ...draft, budgets: draft.budgets.filter((_, j) => j !== i) })} />
          </div>
        ))}
        <div>
          <Btn size="sm" variant="ghost" disabled={off} onClick={() => set({ ...draft, budgets: [...draft.budgets, { metric: '', limit: '' }] })}>
            Add budget
          </Btn>
        </div>
      </fieldset>
      <fieldset className="flex flex-col gap-1.5" disabled={off}>
        <legend className="text-xs font-medium text-fg-secondary">Cadence</legend>
        {draft.cadence.length === 0 && <p className="text-2xs text-fg-muted">No cadence set; gates count as stale after 7 days.</p>}
        {draft.cadence.map((row, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <input
              className={`${FIELD_BASE} flex-1 font-mono`}
              value={row.gate}
              placeholder="dead_handler"
              aria-label={`Cadence ${i + 1} gate`}
              onChange={(e) => set({ ...draft, cadence: draft.cadence.map((r, j) => (j === i ? { ...r, gate: e.target.value } : r)) })}
            />
            <input
              className={`${FIELD_BASE} w-24 shrink-0 font-mono`}
              value={row.every}
              placeholder="P1D"
              aria-label={`Cadence ${i + 1} duration`}
              onChange={(e) => set({ ...draft, cadence: draft.cadence.map((r, j) => (j === i ? { ...r, every: e.target.value } : r)) })}
            />
            <RemoveBtn label={`Remove cadence ${row.gate || i + 1}`} disabled={off} onClick={() => set({ ...draft, cadence: draft.cadence.filter((_, j) => j !== i) })} />
          </div>
        ))}
        <div>
          <Btn size="sm" variant="ghost" disabled={off} onClick={() => set({ ...draft, cadence: [...draft.cadence, { gate: '', every: 'P1D' }] })}>
            Add cadence
          </Btn>
        </div>
      </fieldset>
      <PreviewBar built={built} blocked={blocked} locked={locked} previewing={previewing} onPreview={onPreview} />
    </div>
  )
}

// ── env ──────────────────────────────────────────────────────────────────────

export function EnvForm({ files, locked, previewing, onPreview, onEdit }: ChangeFormProps) {
  const manifest = fileOf(files, MANIFEST_PATH)
  const example = fileOf(files, ENV_EXAMPLE_PATH)
  const parsed = useMemo(() => parseManifest(manifest?.content ?? null), [manifest?.content])
  const [rows, setRows] = useState<EnvRow[]>(() => (parsed.ok ? envRowsFrom(parsed.doc) : []))
  const exampleBlocked = blockedReason(example, ENV_EXAMPLE_PATH)
  const [syncExample, setSyncExample] = useState(exampleBlocked === null)
  const blocked = blockedReason(manifest, MANIFEST_PATH) ?? (parsed.ok ? null : parsed.error)
  const off = blocked !== null || locked
  const built = useMemo(() => buildEnvEdits(files, rows, { syncExample: syncExample && exampleBlocked === null }), [files, rows, syncExample, exampleBlocked])
  const set = (next: EnvRow[]) => {
    setRows(next)
    onEdit()
  }
  const patch = (i: number, p: Partial<EnvRow>) => set(rows.map((r, j) => (j === i ? { ...r, ...p } : r)))

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-fg-secondary">
        Declare the env <span className="font-medium">names</span> your builds need and where each must be set. Mushi checks names only;
        values stay in GitHub and your host, never here.
      </p>
      <fieldset className="flex flex-col gap-2" disabled={off}>
        <legend className="sr-only">Declared env names</legend>
        {rows.length === 0 && <p className="text-2xs text-fg-muted">No env names declared yet.</p>}
        {rows.map((row, i) => (
          <div key={i} className="flex flex-col gap-1.5 rounded-sm border border-edge-subtle/60 p-2">
            <div className="flex items-center gap-1.5">
              <input
                className={`${FIELD_BASE} flex-1 font-mono`}
                value={row.name}
                placeholder="NEXT_PUBLIC_MUSHI_PROJECT_ID"
                autoComplete="off"
                spellCheck={false}
                aria-label={`Env name ${i + 1}`}
                onChange={(e) => patch(i, { name: e.target.value.toUpperCase() })}
              />
              <RemoveBtn label={`Remove ${row.name || `env name ${i + 1}`}`} disabled={off} onClick={() => set(rows.filter((_, j) => j !== i))} />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Checkbox label="GitHub Actions" checked={row.actions} disabled={off} onChange={(v) => patch(i, { actions: v })} />
              <Checkbox label="Runtime (not checked)" checked={row.runtime} disabled={off} onChange={(v) => patch(i, { runtime: v })} />
            </div>
            <input
              className={FIELD_CLS}
              value={row.githubEnvironments}
              placeholder="GitHub environments, e.g. production, preview"
              aria-label={`GitHub environments for ${row.name || `env name ${i + 1}`}`}
              onChange={(e) => patch(i, { githubEnvironments: e.target.value })}
            />
          </div>
        ))}
        <div>
          <Btn size="sm" variant="ghost" disabled={off} onClick={() => set([...rows, newEnvRow()])}>
            Add env name
          </Btn>
        </div>
      </fieldset>
      <div className="flex flex-col gap-1">
        <Checkbox
          label={`Also list the names in ${ENV_EXAMPLE_PATH}`}
          checked={syncExample && exampleBlocked === null}
          disabled={off || exampleBlocked !== null}
          onChange={(v) => {
            setSyncExample(v)
            onEdit()
          }}
        />
        {exampleBlocked && <p className="text-2xs text-fg-muted">{exampleBlocked}</p>}
      </div>
      <PreviewBar built={built} blocked={blocked} locked={locked} previewing={previewing} onPreview={onPreview} />
    </div>
  )
}

// ── routes ───────────────────────────────────────────────────────────────────

export function RoutesForm({ files, locked, previewing, onPreview, onEdit }: ChangeFormProps) {
  const inv = fileOf(files, INVENTORY_PATH)
  const [text, setText] = useState(inv?.content ?? '')
  const blocked = blockedReason(inv, INVENTORY_PATH)
  const off = blocked !== null || locked
  const built = useMemo(() => buildRoutesEdits(files, text), [files, text])
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-fg-secondary">
        <span className="font-mono">inventory.yaml</span> lists your pages, user stories and actions; the inventory gates check the app
        against it. {inv && !inv.exists ? 'The repo has none yet: this creates it.' : ''}
      </p>
      <textarea
        className={`${FIELD_CLS} min-h-64 font-mono leading-relaxed`}
        value={text}
        disabled={off}
        spellCheck={false}
        aria-label="inventory.yaml"
        placeholder={'schema_version: 2\npages:\n  - id: home\n    path: /'}
        onChange={(e) => {
          setText(e.target.value)
          onEdit()
        }}
      />
      <PreviewBar built={built} blocked={blocked} locked={locked} previewing={previewing} onPreview={onPreview} />
    </div>
  )
}
