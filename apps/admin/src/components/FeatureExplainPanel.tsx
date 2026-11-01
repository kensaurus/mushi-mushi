/**
 * Collapsible plain-language explainer for a page section or feature group.
 * Surface rule: opaque raised panel on page bg; inset variant uses page surface inside Cards.
 */

import type { ReactNode } from 'react'
import {
  IconBilling,
  IconChevronDown,
  IconInfo,
  IconShield,
  IconTerminal,
  IconUser,
} from './icons'
import { GUIDE_EXPAND_HINT } from '../lib/guideCopy'
import {
  GUIDE_PANEL_SHELL_DEFAULT,
  GUIDE_PANEL_SHELL_INSET,
  GUIDE_PANEL_SUMMARY_HOVER,
} from '../lib/guideSurfaces'

export type GuideCategory = 'guide' | 'roles' | 'billing' | 'security' | 'workflow'

const CATEGORY_ICON: Record<GuideCategory, typeof IconInfo> = {
  guide: IconInfo,
  roles: IconUser,
  billing: IconBilling,
  security: IconShield,
  workflow: IconTerminal,
}

interface FeatureExplainPanelProps {
  title: string
  summary: string
  children?: ReactNode
  /** Start expanded when the user likely needs guidance (warn/danger context). */
  defaultOpen?: boolean
  /** Semantic icon — replaces generic "i" badge. */
  category?: GuideCategory
  /** inset = inside Card/Section — page surface, not another raised stack. */
  variant?: 'default' | 'inset'
}

export function FeatureExplainPanel({
  title,
  summary,
  children,
  defaultOpen = false,
  category = 'guide',
  variant = 'default',
}: FeatureExplainPanelProps) {
  const Icon = CATEGORY_ICON[category]
  const shellClass = variant === 'inset' ? GUIDE_PANEL_SHELL_INSET : GUIDE_PANEL_SHELL_DEFAULT

  return (
    <details open={defaultOpen} className={`group rounded-md overflow-hidden ${shellClass}`}>
      <summary
        className={`cursor-pointer select-none list-none px-3 py-2 text-xs font-medium text-fg transition-opacity ${GUIDE_PANEL_SUMMARY_HOVER} [&::-webkit-details-marker]:hidden`}
      >
        <span className="inline-flex items-center gap-2 min-w-0">
          <span aria-hidden className="inline-flex shrink-0 text-fg-muted">
            <Icon size={14} />
          </span>
          <span className="min-w-0 truncate">{title}</span>
          <span className="ml-auto flex items-center gap-1 text-fg-faint font-normal text-2xs shrink-0 group-open:hidden">
            {GUIDE_EXPAND_HINT}
            <IconChevronDown size={12} />
          </span>
          <IconChevronDown
            size={12}
            className="text-fg-faint shrink-0 hidden group-open:inline motion-safe:rotate-180"
            aria-hidden
          />
        </span>
      </summary>
      <div className="border-t border-edge-subtle px-3 py-3 space-y-2">
        <p className="text-2xs leading-relaxed text-fg-muted">{summary}</p>
        {children}
      </div>
    </details>
  )
}

interface EffectCalloutProps {
  label?: string
  children: ReactNode
}

/** One visible line under a settings section: "What this changes for your app."
 *
 *  Deliberately borderless. Every call site sits directly inside a `Section`,
 *  which is itself a bordered Card — the old `ContainedBlock` drew a second
 *  outline immediately inside the first, so each settings group opened with a
 *  box in a box. The grey `bg-surface-overlay` fill that replaced it was the
 *  darkest grey in the light ramp (L=0.92) inside a white card, so it is now a
 *  left rule: separated from the fields, no second surface. */
export function SettingEffectCallout({ label = 'What this changes', children }: EffectCalloutProps) {
  return (
    <div className="border-l-2 border-edge-subtle pl-3 py-0.5">
      <p className="text-2xs leading-relaxed text-fg-muted">
        <span className="font-medium text-fg-secondary">{label}:</span> {children}
      </p>
    </div>
  )
}
