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
import { ContainedBlock } from './report-detail/ReportSurface'
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
        className={`cursor-pointer select-none list-none px-3 py-2 text-xs font-medium text-fg transition-colors ${GUIDE_PANEL_SUMMARY_HOVER} [&::-webkit-details-marker]:hidden`}
      >
        <span className="inline-flex items-center gap-2 min-w-0">
          <span
            aria-hidden
            className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm border border-edge-subtle text-fg-muted"
          >
            <Icon size={12} />
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

/** One visible line under a settings section: "What this changes for your app." */
export function SettingEffectCallout({ label = 'What this changes', children }: EffectCalloutProps) {
  return (
    <ContainedBlock tone="muted">
      <p className="text-2xs leading-relaxed text-fg-muted">
        <span className="font-medium text-fg-secondary">{label}:</span> {children}
      </p>
    </ContainedBlock>
  )
}
