/**
 * FILE: apps/admin/src/components/design/DuplicateDirectionForm.tsx
 * PURPOSE: "Duplicate / edit direction": a new folder name, an optional
 *          display name, and optional colour edits applied to the copy
 *          (TokenEditor, colour tokens only). Submitting asks for a dry-run
 *          preview; nothing is written until the preview is confirmed.
 */

import { useMemo, useState } from 'react'
import { Btn, DisclosurePanel, Input } from '../ui'
import type { DesignDirection, DesignEditability, DesignToken, TokenEdit } from '../../lib/recipeTypes'
import { editKey, formatEditValue } from './designTokens'
import { orderPalette } from './directionMock'
import { TokenEditor } from './TokenEditor'

const NAME_RE = /^[a-z0-9][a-z0-9-]{1,40}$/

export interface DuplicateRequest {
  from: string
  name: string
  displayName?: string
  edits?: Array<Omit<TokenEdit, 'set'>>
}

interface DuplicateDirectionFormProps {
  source: DesignDirection
  existingNames: readonly string[]
  locked: boolean
  onSubmit: (req: DuplicateRequest) => void
  onCancel: () => void
}

function nameError(name: string, existing: readonly string[]): string | null {
  if (name === '') return null
  if (!NAME_RE.test(name)) return 'Use 2–41 lowercase letters, digits or hyphens, starting with a letter or digit.'
  if (existing.includes(name)) return 'A direction with this folder name already exists.'
  return null
}

export function DuplicateDirectionForm({ source, existingNames, locked, onSubmit, onCancel }: DuplicateDirectionFormProps) {
  const [name, setName] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [edits, setEdits] = useState<Map<string, Omit<TokenEdit, 'set'>>>(() => new Map())

  const colours = useMemo<DesignToken[]>(() => orderPalette(source), [source])
  // The copy's colours are edited against the source direction's own files.
  const editability = useMemo<DesignEditability>(
    () => ({
      enabled: true,
      reason: null,
      tokenFiles: source.files.filter((f) => f.role === 'source').map((f) => f.path),
      manifestWritable: false,
    }),
    [source.files],
  )

  const error = nameError(name, existingNames)
  const ready = name !== '' && error === null && !locked
  const queued = [...edits.values()]

  return (
    <form
      className="flex flex-col gap-3 rounded-md border border-edge-subtle p-3"
      onSubmit={(e) => {
        e.preventDefault()
        if (!ready) return
        onSubmit({
          from: source.name,
          name,
          ...(displayName.trim() ? { displayName: displayName.trim() } : {}),
          ...(queued.length > 0 ? { edits: queued } : {}),
        })
      }}
    >
      <p className="text-xs text-fg-secondary">
        Copies <span className="font-mono">{source.name}</span> into a new <span className="font-mono">directions/</span>{' '}
        folder. You will see the diff before a draft PR is opened.
      </p>
      <Input
        label="New folder name"
        id={`dup-name-${source.name}`}
        value={name}
        placeholder={`${source.name}-v2`}
        onChange={(e) => setName(e.target.value.trim())}
        error={error ?? undefined}
        disabled={locked}
      />
      <Input
        label="Display name (optional)"
        id={`dup-display-${source.name}`}
        value={displayName}
        placeholder={`${source.displayName} v2`}
        onChange={(e) => setDisplayName(e.target.value)}
        disabled={locked}
      />
      <DisclosurePanel
        title="Colour edits on the copy (optional)"
        trailing={queued.length > 0 ? <span className="text-2xs text-fg-muted">{queued.length} queued</span> : null}
      >
        {colours.length === 0 ? (
          <p className="text-xs text-fg-muted">This direction has no colour tokens.</p>
        ) : (
          <ul className="flex max-h-80 flex-col gap-2 overflow-y-auto">
            {colours.map((t) => {
              const q = edits.get(editKey({ path: t.path }))
              return (
                <li key={t.path} className="flex flex-col gap-1">
                  <span className="flex items-center gap-2 text-2xs">
                    <span
                      className="h-4 w-4 shrink-0 rounded-sm border border-edge"
                      style={{ background: t.hex ?? 'transparent' }}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 truncate font-mono text-fg">{t.path}</span>
                    <span className="font-mono text-fg-muted">{t.hex}</span>
                    {q && <span className="font-mono text-fg-secondary">→ {formatEditValue(q.value)}</span>}
                  </span>
                  <TokenEditor
                    token={t}
                    editable={editability}
                    set={null}
                    queued={q ? { ...q } : undefined}
                    locked={locked}
                    onQueue={(edit) =>
                      setEdits((cur) => {
                        const next = new Map(cur)
                        next.set(editKey({ path: edit.path }), { path: edit.path, value: edit.value })
                        return next
                      })
                    }
                  />
                </li>
              )
            })}
          </ul>
        )}
        {queued.length > 0 && (
          <div className="mt-2">
            <Btn
              size="sm"
              variant="ghost"
              type="button"
              onClick={() => setEdits(new Map())}
              disabled={locked}
              title={locked ? 'Finish or discard the current change first' : 'Drop every queued colour edit'}
            >
              Clear colour edits
            </Btn>
          </div>
        )}
      </DisclosurePanel>
      <div className="flex flex-wrap gap-2">
        <Btn
          size="sm"
          variant="primary"
          type="submit"
          disabled={!ready}
          title={
            locked
              ? 'Finish or discard the current change first'
              : name === ''
                ? 'Enter a folder name first'
                : error ?? 'Preview the new direction before anything is written'
          }
        >
          Preview duplicate
        </Btn>
        <Btn size="sm" variant="ghost" type="button" onClick={onCancel}>
          Cancel
        </Btn>
      </div>
    </form>
  )
}
