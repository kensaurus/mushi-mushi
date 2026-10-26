/**
 * FILE: apps/admin/src/components/sidebar/SectionRailHeader.tsx
 * PURPOSE: Collapsed-rail section picker (step glyph + staleness badge).
 *
 * OVERVIEW:
 * - Shares the 44px rail geometry and flyout with NavRailLink.
 * - The count pill is aria-hidden; the name is a title plus the sr-only description.
 *
 * DEPENDENCIES:
 * - NavRailFlyout, NavRailLink helpers, Tooltip, CHIP_TONE
 *
 * USAGE:
 * - Layout renders one header per sidebar section.
 * - nav-rail.test.tsx renders it to assert the badge title.
 */

import { CHIP_TONE } from '../../lib/chipTone'
import { Tooltip } from '../ui'
import { NavRailFlyout } from './NavRailFlyout'
import { railBadgeText, railDescriptionId } from './NavRailLink'

export interface SectionRailStaleness {
  count: number
  tone: 'ok' | 'warn' | 'danger'
  label: string
}

export interface SectionRailSection {
  id: string
  title: string
  hint?: string
  step?: number
  stage?: 'P' | 'D' | 'C' | 'A'
}

const STAGE_TONE: Record<NonNullable<SectionRailSection['stage']>, string> = {
  P: CHIP_TONE.infoSubtle,
  D: CHIP_TONE.brandSubtle,
  C: CHIP_TONE.warnSubtle,
  A: CHIP_TONE.okSubtle,
}

const STALENESS_TONE: Record<SectionRailStaleness['tone'], string> = {
  ok: CHIP_TONE.okSubtle,
  warn: CHIP_TONE.warnSubtle,
  danger: CHIP_TONE.dangerSubtle,
}

/** Step number (1–5) / letter glyph for the icon-rail section picker. */
function railSectionGlyph(section: SectionRailSection): string {
  if (section.step) return String(section.step)
  if (section.stage) return section.stage
  if (section.id === 'labs') return 'L'
  return section.title.charAt(0).toUpperCase()
}

interface SectionRailHeaderProps {
  section: SectionRailSection
  expanded: boolean
  isActiveStage: boolean
  staleness: SectionRailStaleness | null
  onSelect: () => void
}

/**
 * Rail section picker (1 – 5 for the cycle steps, A for Account). Shares `.nav-rail-item`
 * geometry with the item rows so the whole rail sits on one 44px rhythm, and
 * shares the flyout so a section explains itself in the same shape an item
 * does — the section `hint` copy already reads as plain English.
 */
export function SectionRailHeader({ section, expanded, isActiveStage, staleness, onSelect }: SectionRailHeaderProps) {
  const glyph = railSectionGlyph(section)
  const stageTone = section.stage
    ? STAGE_TONE[section.stage]
    : 'bg-surface-overlay text-fg-secondary border border-edge-subtle'
  const descId = railDescriptionId(`section-${section.id}`)
  return (
    <Tooltip
      side="right"
      portal
      content={
        <NavRailFlyout
          title={section.title}
          description={section.hint}
          status={staleness ? { tone: staleness.tone, label: staleness.label } : null}
          kicker={section.stage ? { label: glyph, className: stageTone } : null}
          hint={expanded ? undefined : 'Opens this group in the full sidebar'}
        />
      }
    >
      {/* mushi-ui: chrome icon button — Btn variant TBD (PDCA rail glyph + staleness badge layout) */}
      <button
        type="button"
        onClick={onSelect}
        aria-expanded={expanded}
        aria-current={expanded ? 'true' : undefined}
        aria-label={`${section.title}${expanded ? '' : ' — show navigation'}`}
        aria-describedby={descId}
        className={`nav-rail-item ${
          expanded
            ? 'bg-surface-overlay text-fg ring-1 ring-brand/40'
            : isActiveStage
              ? 'ring-1 ring-brand/25'
              : ''
        }`}
      >
        {/* Badge anchors to the GLYPH, not the button: anchoring it to the
            button pushed it into the rail's border and over the glyph itself.
            The ring separates the count from the glyph underneath it. */}
        <span className="nav-rail-glyph">
          <span className={`nav-rail-stamp ${stageTone}`} aria-hidden="true">
            {glyph}
          </span>
          {staleness && (
            <span
              aria-hidden="true"
              title={staleness.label}
              className={`nav-rail-badge ring-1 ring-surface-root ${STALENESS_TONE[staleness.tone]}`}
            >
              {railBadgeText(staleness.count)}
            </span>
          )}
        </span>
        <span id={descId} className="sr-only">
          {section.hint}
          {staleness ? ` — ${staleness.label}` : ''}
        </span>
      </button>
    </Tooltip>
  )
}
