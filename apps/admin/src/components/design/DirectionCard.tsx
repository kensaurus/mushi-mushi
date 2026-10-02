/**
 * FILE: apps/admin/src/components/design/DirectionCard.tsx
 * PURPOSE: One art direction on the Directions board: names and concept, a
 *          phone mock of the same lesson moment, palette (semantic roles
 *          first), computed contrast, a type specimen per declared family,
 *          line/shape and motion notes, assets, deviance, and the two actions
 *          (set active, duplicate/edit) that each end in a reviewed draft PR.
 */

import { useMemo, type ReactNode } from 'react'
import { Badge, Btn, DataTableCell, DataTableHead } from '../ui'
import { RESOLVED_API_URL } from '../../lib/env'
import type { DesignDirection, DesignDirectionsResponse } from '../../lib/recipeTypes'
import { RecipeStateGlyph } from '../recipe/RecipeStateChip'
import { formatRatio } from './designTokens'
import { directionAssetUrl, orderPalette, resolveDirectionRoles } from './directionMock'
import { DirectionPhoneMock } from './DirectionPhoneMock'
import { DuplicateDirectionForm, type DuplicateRequest } from './DuplicateDirectionForm'
import { DesignChangePreview } from './DesignChangePreview'
import type { DesignChangeState } from './useDesignChange'

const MAX_SWATCHES = 24
const MAX_ASSETS = 6

export type DirectionAction = { kind: 'activate' | 'duplicate'; direction: string } | null

function Heading({ children }: { children: ReactNode }) {
  return (
    <h3 className="mt-5 border-t border-edge pt-2 font-mono text-2xs font-semibold uppercase tracking-wider text-fg-secondary">
      {children}
    </h3>
  )
}

function Verdict({ pass }: { pass: boolean | null }) {
  if (pass === true)
    return (
      <Badge tone="okSubtle" className="gap-1">
        <RecipeStateGlyph glyph="check" />
        <span data-verdict="pass">Pass</span>
      </Badge>
    )
  if (pass === false)
    return (
      <Badge tone="dangerSubtle" className="gap-1">
        <RecipeStateGlyph glyph="cross" />
        <span data-verdict="fail">Fail</span>
      </Badge>
    )
  return (
    <Badge tone="neutral" className="gap-1">
      <RecipeStateGlyph glyph="question" />
      <span data-verdict="unknown">Not judged</span>
    </Badge>
  )
}

function DevianceLine({ direction }: { direction: DesignDirection }) {
  if (!direction.active) {
    return <p className="text-xs text-fg-muted">Not scanned — only the active direction is scanned.</p>
  }
  const d = direction.deviance
  if (!d) return <p className="text-xs text-fg-muted">Not scanned yet. Run a deviance check from the Tokens view.</p>
  if (d.status === 'running') return <p className="text-xs text-fg-muted">A scan is running.</p>
  if (d.score === null) {
    return (
      <p className="text-xs text-fg-secondary">
        <span className="font-semibold">Not scored</span> — the last scan ({d.status}) had nothing it could judge.
      </p>
    )
  }
  return (
    <p className="text-xs text-fg-secondary">
      Deviance score <span className="font-mono text-sm font-semibold text-fg">{Math.round(d.score)}</span> / 100 (lower
      is better) · {d.status}
    </p>
  )
}

interface DirectionCardProps {
  direction: DesignDirection
  specimen: DesignDirectionsResponse['specimen']
  editable: DesignDirectionsResponse['editable']
  existingNames: readonly string[]
  /** The action this board is working on (one at a time), or null. */
  action: DirectionAction
  change: DesignChangeState
  locked: boolean
  onStartAction: (action: NonNullable<DirectionAction>) => void
  onCancelAction: () => void
  onActivate: (direction: string) => void
  onDuplicate: (req: DuplicateRequest) => void
  onConfirm: () => void
  onDiscard: () => void
}

export function DirectionCard({
  direction,
  specimen,
  editable,
  existingNames,
  action,
  change,
  locked,
  onStartAction,
  onCancelAction,
  onActivate,
  onDuplicate,
  onConfirm,
  onDiscard,
}: DirectionCardProps) {
  const roles = useMemo(() => resolveDirectionRoles(direction.tokens), [direction.tokens])
  const palette = useMemo(() => orderPalette(direction), [direction])
  const mine = action?.direction === direction.name ? action : null
  const busyElsewhere = locked && !mine

  return (
    <section
      className="min-w-0 border-b border-edge px-4 py-6 last:border-b-0 min-[1100px]:border-b-0 min-[1100px]:border-r min-[1100px]:px-5 min-[1100px]:last:border-r-0"
      aria-labelledby={`direction-${direction.name}`}
      data-testid="direction-card"
      data-direction={direction.name}
    >
      <header className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id={`direction-${direction.name}`} className="text-lg font-semibold text-fg">
            {direction.displayName}
          </h2>
          {direction.nativeName && <span className="text-base text-fg-secondary">{direction.nativeName}</span>}
          {direction.active && (
            <Badge tone="okSubtle" className="gap-1" title="mushi.recipe.json points at this direction">
              <RecipeStateGlyph glyph="check" />
              <span data-testid="active-badge">Active</span>
            </Badge>
          )}
          {direction.readOnly && (
            <Badge
              tone="neutral"
              className="gap-1"
              title="A comparison set: never scanned and never edited in place. Set active or duplicate it to change it."
            >
              <RecipeStateGlyph glyph="ring" />
              <span data-testid="read-only-badge">Read-only — inactive</span>
            </Badge>
          )}
        </div>
        <p className="font-mono text-2xs text-fg-muted">
          directions/{direction.name} · {direction.tokenCount.toLocaleString()} tokens
          {direction.issues.length > 0 ? ` · ${direction.issues.length} token issues` : ''}
        </p>
        {direction.concept && <p className="text-sm text-fg-secondary">{direction.concept}</p>}
        {direction.note && (
          <p className="text-xs text-fg-secondary" data-testid="direction-note">
            <span className="font-medium text-fg">Note:</span> {direction.note}
          </p>
        )}
      </header>

      <DirectionPhoneMock label={direction.displayName} roles={roles} word={specimen.word} sample={specimen.sample} />
      {roles.defaulted.length > 0 && (
        <p className="text-center text-2xs text-fg-muted">
          No token for: {roles.defaulted.join(', ')} — shown with neutral defaults.
        </p>
      )}

      <Heading>Palette</Heading>
      {palette.length === 0 ? (
        <p className="text-xs text-fg-muted">No colour tokens.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 min-[1100px]:grid-cols-2">
          {palette.slice(0, MAX_SWATCHES).map((t) => (
            <li key={t.path} className="flex min-w-0 items-center gap-2">
              <span
                className="h-7 w-7 shrink-0 border border-edge"
                style={{ background: t.hex ?? 'transparent' }}
                role="img"
                aria-label={`Swatch ${t.hex}`}
              />
              <span className="flex min-w-0 flex-col font-mono text-2xs">
                <span className="truncate text-fg" title={t.path}>
                  {t.path.replace(/^color\./, '')}
                </span>
                <span className="text-fg-muted">{t.hex}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {palette.length > MAX_SWATCHES && (
        <p className="mt-1 text-2xs text-fg-faint">+{palette.length - MAX_SWATCHES} more colour tokens</p>
      )}

      <Heading>Contrast (computed)</Heading>
      {direction.contrast.length === 0 ? (
        <p className="text-xs text-fg-muted">No contrast pairs declared in mushi.recipe.json.</p>
      ) : (
        <table className="w-full table-fixed text-xs">
          <thead>
            <tr>
              <DataTableHead className="w-14">Sample</DataTableHead>
              <DataTableHead>Use</DataTableHead>
              <DataTableHead align="right" className="w-16">
                Ratio
              </DataTableHead>
              <DataTableHead align="right" className="w-20">
                Result
              </DataTableHead>
            </tr>
          </thead>
          <tbody>
            {direction.contrast.map((p, i) => (
              <tr key={`${p.fg}|${p.bg}|${i}`} className="border-t border-edge-subtle align-middle">
                <DataTableCell>
                  {p.fgHex && p.bgHex ? (
                    <span
                      className="inline-block border border-edge-subtle px-1.5 py-0.5 font-bold"
                      style={{ color: p.fgHex, background: p.bgHex, fontFamily: roles.fontBody }}
                      role="img"
                      aria-label={`${p.fg} on ${p.bg}`}
                    >
                      Aa ก
                    </span>
                  ) : (
                    <span className="text-2xs text-fg-faint">n/a</span>
                  )}
                </DataTableCell>
                <DataTableCell>
                  <span className="wrap-break-word text-fg-secondary">{p.use ?? `${p.fg} on ${p.bg}`}</span>
                  {p.pass === null && p.problem && <span className="block text-2xs text-fg-muted">{p.problem}</span>}
                </DataTableCell>
                <DataTableCell align="right">
                  <span className="block font-mono tabular-nums" data-testid="direction-contrast-ratio">
                    {formatRatio(p.ratio)}
                  </span>
                  <span className="block text-2xs text-fg-faint">≥{p.min}</span>
                </DataTableCell>
                <DataTableCell align="right">
                  <Verdict pass={p.pass} />
                </DataTableCell>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <Heading>Type</Heading>
      {direction.fonts.length === 0 ? (
        <p className="text-xs text-fg-muted">No font families declared.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {direction.fonts.map((f) => {
            const family = f.families.length > 0 ? f.families.map((n) => (n.includes(' ') ? `"${n}"` : n)).join(', ') : 'inherit'
            return (
              <li key={f.path} className="overflow-hidden border border-edge-subtle p-2.5">
                <p className="font-mono text-2xs text-fg-muted">
                  {f.role} · {f.families.join(', ') || 'no families'}
                </p>
                <p className="text-2xl leading-snug wrap-anywhere text-fg" style={{ fontFamily: family }}>
                  {specimen.sample}
                </p>
                <p className="text-base wrap-anywhere text-fg-secondary" style={{ fontFamily: family }}>
                  {specimen.latin}
                </p>
              </li>
            )
          })}
        </ul>
      )}

      <Heading>Line and shape</Heading>
      <NoteList items={direction.line} empty="No line or shape tokens." />

      <Heading>Motion</Heading>
      <NoteList items={direction.motion} empty="No motion tokens." />

      <Heading>Assets</Heading>
      {direction.assets.length === 0 ? (
        <p className="text-xs text-fg-muted">No assets declared.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-2">
          {direction.assets.slice(0, MAX_ASSETS).map((a) => {
            const src = directionAssetUrl(a.url, RESOLVED_API_URL)
            return (
              <li key={a.path} className="flex min-w-0 flex-col gap-1" data-testid="direction-asset">
                {src ? (
                  <img
                    src={src}
                    alt={`${a.kind}: ${a.path}`}
                    loading="lazy"
                    className="max-h-40 w-full border border-edge-subtle object-contain"
                  />
                ) : (
                  <span className="flex h-20 items-center justify-center border border-dashed border-edge text-2xs text-fg-faint">
                    preview unavailable
                  </span>
                )}
                <span className="truncate font-mono text-2xs text-fg-muted" title={a.path}>
                  {a.path}
                </span>
              </li>
            )
          })}
        </ul>
      )}
      {direction.assets.length > MAX_ASSETS && (
        <p className="mt-1 text-2xs text-fg-faint">+{direction.assets.length - MAX_ASSETS} more assets</p>
      )}

      <Heading>Deviance</Heading>
      <DevianceLine direction={direction} />

      <Heading>Actions</Heading>
      {!editable.enabled ? (
        <p className="text-xs text-fg-muted">{editable.reason ?? 'Changes are not available for this project.'}</p>
      ) : (
        <div className="flex flex-col gap-3">
          {direction.readOnly && !mine && (
            <p className="text-2xs text-fg-muted">
              Both actions open a draft PR; neither edits this direction&apos;s own files.
            </p>
          )}
          {!mine && (
            <div className="flex flex-wrap gap-2">
              {!direction.active && (
                <Btn
                  size="sm"
                  variant="primary"
                  disabled={busyElsewhere}
                  title={busyElsewhere ? 'Finish or discard the current change first' : 'Preview pointing mushi.recipe.json at this direction'}
                  onClick={() => {
                    onStartAction({ kind: 'activate', direction: direction.name })
                    onActivate(direction.name)
                  }}
                >
                  Set active direction
                </Btn>
              )}
              <Btn
                size="sm"
                variant="ghost"
                disabled={busyElsewhere}
                title={busyElsewhere ? 'Finish or discard the current change first' : 'Copy this direction into a new folder'}
                onClick={() => onStartAction({ kind: 'duplicate', direction: direction.name })}
              >
                Duplicate / edit direction
              </Btn>
            </div>
          )}
          {mine?.kind === 'duplicate' && (
            // Stays mounted while the preview runs so a failed preview keeps what was typed.
            <div hidden={change.phase !== 'idle' && change.phase !== 'error'}>
              <DuplicateDirectionForm
                source={direction}
                existingNames={existingNames}
                locked={locked}
                onSubmit={onDuplicate}
                onCancel={onCancelAction}
              />
            </div>
          )}
          {mine && <DesignChangePreview state={change} onConfirm={onConfirm} onDiscard={onDiscard} />}
        </div>
      )}
    </section>
  )
}

function NoteList({ items, empty }: { items: Array<{ path: string; display: string }>; empty: string }) {
  if (items.length === 0) return <p className="text-xs text-fg-muted">{empty}</p>
  return (
    <dl className="flex flex-col gap-0.5 text-xs">
      {items.map((m) => (
        <div key={m.path} className="flex min-w-0 items-baseline justify-between gap-3">
          <dt className="min-w-0 truncate font-mono text-2xs text-fg-muted">{m.path}</dt>
          <dd className="shrink-0 font-mono text-2xs text-fg">{m.display}</dd>
        </div>
      ))}
    </dl>
  )
}
