/**
 * FILE: apps/admin/src/components/design/DesignTokenSections.tsx
 * PURPOSE: Renders a project's design tokens visually, grouped by section and
 *          then by the token's own `group`: colour swatches, type samples
 *          (Latin + Thai), spacing bars, radius boxes, motion values and a
 *          plain table for anything else. All colours, sizes and families are
 *          applied from token DATA via inline style — none are written here.
 */

import type { ReactNode } from 'react'
import { Section } from '../ui'
import type { DesignEditability, DesignToken, TokenEdit } from '../../lib/recipeTypes'
import {
  TOKEN_SECTION_LABEL,
  clampPx,
  cubicBezierString,
  editKey,
  sectionTokens,
  typographyParts,
  type TokenSection,
} from './designTokens'
import { TokenEditor } from './TokenEditor'

const LATIN_SAMPLE = 'The quick brown fox jumps over the lazy dog 0123456789'
const THAI_SAMPLE = 'ภาษาไทยสวัสดีครับ เรียนภาษา'
const MAX_TYPE_PX = 64
const MAX_BAR_PX = 480
const MAX_RADIUS_BOX_PX = 64

interface SectionProps {
  tokens: DesignToken[]
  editable: DesignEditability
  set: string | null
  queued: Map<string, TokenEdit>
  onQueue: (edit: TokenEdit) => void
  locked: boolean
}

function TokenNames({ token }: { token: DesignToken }) {
  const names = [token.cssVar, token.ts, token.rn].filter((n): n is string => Boolean(n))
  return (
    <span className="flex flex-col gap-0.5 font-mono text-2xs">
      <span className="text-fg wrap-break-word">{token.path}</span>
      {names.length > 0 && <span className="text-fg-faint wrap-break-word">{names.join(' · ')}</span>}
      {token.aliasOf && <span className="text-fg-muted">alias of {token.aliasOf}</span>}
    </span>
  )
}

function EditSlot({ token, editable, set, queued, onQueue, locked }: { token: DesignToken } & Omit<SectionProps, 'tokens'>) {
  return (
    <TokenEditor
      token={token}
      editable={editable}
      set={set}
      queued={queued.get(editKey({ path: token.path, set: set ?? undefined }))}
      onQueue={onQueue}
      locked={locked}
    />
  )
}

function ColorTokens(props: SectionProps) {
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {props.tokens.map((t) => (
        <li key={t.path} className="flex flex-col gap-2 rounded-md border border-edge-subtle p-2">
          <div className="flex items-start gap-3">
            {t.hex ? (
              <span
                className="h-12 w-12 shrink-0 rounded-sm border border-edge"
                style={{ background: t.hex }}
                role="img"
                aria-label={`Swatch ${t.hex}`}
              />
            ) : (
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-sm border border-dashed border-edge text-2xs text-fg-faint">
                n/a
              </span>
            )}
            <div className="min-w-0 flex-1">
              <TokenNames token={t} />
              <span className="font-mono text-2xs text-fg-secondary">{t.hex ?? t.display}</span>
            </div>
          </div>
          <EditSlot token={t} {...props} />
        </li>
      ))}
    </ul>
  )
}

function TypeTokens(props: SectionProps) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-2xs text-fg-muted">
        Shown in the declared family if installed; otherwise your system fallback.
      </p>
      <ul className="flex flex-col gap-3">
        {props.tokens.map((t) => {
          const parts = typographyParts(t)
          const size = clampPx(parts.sizePx, MAX_TYPE_PX)
          const style = {
            fontFamily: parts.family,
            fontSize: size.px ?? undefined,
            fontWeight: parts.weight ?? undefined,
            lineHeight: parts.lineHeight ?? undefined,
          }
          return (
            <li key={t.path} className="flex flex-col gap-1.5 border-b border-edge-subtle pb-3 last:border-b-0">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <TokenNames token={t} />
                <span className="font-mono text-2xs text-fg-secondary">
                  {t.display}
                  {size.clamped && ' (sample capped)'}
                </span>
              </div>
              <p className="overflow-hidden text-ellipsis text-fg" style={style}>
                {LATIN_SAMPLE}
              </p>
              <p lang="th" className="overflow-hidden text-ellipsis text-fg" style={style}>
                {THAI_SAMPLE}
              </p>
              <EditSlot token={t} {...props} />
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function SpacingTokens(props: SectionProps) {
  return (
    <ul className="flex flex-col gap-2">
      {props.tokens.map((t) => {
        const w = clampPx(t.px, MAX_BAR_PX)
        return (
          <li key={t.path} className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-3">
              <div className="w-48 shrink-0">
                <TokenNames token={t} />
              </div>
              <span className="w-16 shrink-0 font-mono text-2xs text-fg-secondary">{t.display}</span>
              {w.px !== null ? (
                <span
                  className="block h-3 rounded-sm bg-brand/60"
                  style={{ width: Math.max(w.px, 1) }}
                  aria-hidden="true"
                />
              ) : (
                <span className="text-2xs text-fg-faint">No px value</span>
              )}
              {w.clamped && <span className="text-2xs text-fg-faint">(bar capped)</span>}
            </div>
            <EditSlot token={t} {...props} />
          </li>
        )
      })}
    </ul>
  )
}

function RadiusTokens(props: SectionProps) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {props.tokens.map((t) => {
        const r = clampPx(t.px, MAX_RADIUS_BOX_PX)
        return (
          <li key={t.path} className="flex flex-col gap-2">
            <span
              className="block h-16 w-16 border-2 border-brand/60 bg-brand/10"
              style={{ borderRadius: r.px ?? 0 }}
              aria-hidden="true"
            />
            <TokenNames token={t} />
            <span className="font-mono text-2xs text-fg-secondary">{t.display}</span>
            <EditSlot token={t} {...props} />
          </li>
        )
      })}
    </ul>
  )
}

function MotionTokens(props: SectionProps) {
  return (
    <ul className="flex flex-col gap-2">
      {props.tokens.map((t) => (
        <li key={t.path} className="flex flex-col gap-1">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <TokenNames token={t} />
            <span className="font-mono text-2xs text-fg-secondary">
              {t.type === 'cubicBezier' ? cubicBezierString(t) : t.display}
            </span>
          </div>
          <EditSlot token={t} {...props} />
        </li>
      ))}
    </ul>
  )
}

function OtherTokens(props: SectionProps) {
  return (
    <ul className="flex flex-col gap-2">
      {props.tokens.map((t) => (
        <li key={t.path} className="flex flex-col gap-1">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <TokenNames token={t} />
            <span className="font-mono text-2xs text-fg-secondary">
              {t.type ?? 'untyped'} · {t.display}
            </span>
          </div>
          <EditSlot token={t} {...props} />
        </li>
      ))}
    </ul>
  )
}

const SECTION_RENDERER: Record<TokenSection, (p: SectionProps) => ReactNode> = {
  color: ColorTokens,
  type: TypeTokens,
  spacing: SpacingTokens,
  radius: RadiusTokens,
  motion: MotionTokens,
  other: OtherTokens,
}

interface DesignTokenSectionsProps {
  tokens: DesignToken[]
  editable: DesignEditability
  set: string | null
  queued: Map<string, TokenEdit>
  onQueue: (edit: TokenEdit) => void
  locked: boolean
}

export function DesignTokenSections({ tokens, editable, set, queued, onQueue, locked }: DesignTokenSectionsProps) {
  const sections = sectionTokens(tokens)
  if (sections.length === 0) {
    return (
      <Section title="Tokens">
        <p className="text-xs text-fg-muted">No tokens in this set.</p>
      </Section>
    )
  }
  return (
    <>
      {sections.map(({ section, groups }) => {
        const Render = SECTION_RENDERER[section]
        const count = groups.reduce((n, g) => n + g.tokens.length, 0)
        return (
          <Section
            key={section}
            title={TOKEN_SECTION_LABEL[section]}
            action={<span className="text-2xs text-fg-faint">{count.toLocaleString()} tokens</span>}
          >
            <div className="flex flex-col gap-4">
              {groups.map((g) => (
                <div key={g.group} className="flex flex-col gap-2">
                  {groups.length > 1 && (
                    <h3 className="font-mono text-2xs uppercase tracking-wider text-fg-muted">{g.group}</h3>
                  )}
                  <Render tokens={g.tokens} editable={editable} set={set} queued={queued} onQueue={onQueue} locked={locked} />
                </div>
              ))}
            </div>
          </Section>
        )
      })}
    </>
  )
}
