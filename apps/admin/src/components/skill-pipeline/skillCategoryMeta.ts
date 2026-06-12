/**
 * Visual + copy metadata for cursor-kenji skill categories.
 * Used by SkillPipelinesPage catalog headers and skill cards.
 */
import type { ComponentType } from 'react'

type CategoryIconProps = { size?: number; className?: string }
import {
  IconAudit,
  IconBolt,
  IconExport,
  IconGraph,
  IconMenu,
  IconNetwork,
  IconNote,
  IconPencil,
  IconPlay,
  IconShield,
  IconSkills,
  IconSliders,
  IconSparkle,
  IconStorage,
  IconTerminal,
} from '../icons'

export interface SkillCategoryMeta {
  label: string
  hint: string
  Icon: ComponentType<CategoryIconProps>
  /** Icon badge: background + foreground */
  badgeClass: string
  /** Optional left accent on category section */
  accentClass: string
}

export const SKILL_CATEGORY_META: Record<string, SkillCategoryMeta> = {
  workflow: {
    label: 'Workflows',
    hint: 'Multi-step bundles that chain skills end-to-end',
    Icon: IconGraph,
    badgeClass: 'bg-violet-500/15 text-violet-400',
    accentClass: 'border-l-violet-500/50',
  },
  debug: {
    label: 'Debug',
    hint: 'Reproduce, isolate, and fix errors with production context',
    Icon: IconTerminal,
    badgeClass: 'bg-amber-500/15 text-amber-400',
    accentClass: 'border-l-amber-500/50',
  },
  test: {
    label: 'Test',
    hint: 'Playwright sweeps, QA coverage, and adversarial red-team',
    Icon: IconPlay,
    badgeClass: 'bg-emerald-500/15 text-emerald-400',
    accentClass: 'border-l-emerald-500/50',
  },
  audit: {
    label: 'Audit',
    hint: 'Security, accessibility, performance, and design-system checks',
    Icon: IconAudit,
    badgeClass: 'bg-sky-500/15 text-sky-400',
    accentClass: 'border-l-sky-500/50',
  },
  enhance: {
    label: 'Enhance',
    hint: 'Polish UI, UX, SEO, PWA, and post-launch iteration',
    Icon: IconSparkle,
    badgeClass: 'bg-rose-500/15 text-rose-400',
    accentClass: 'border-l-rose-500/50',
  },
  backend: {
    label: 'Backend',
    hint: 'API design, observability, error handling, and data pipelines',
    Icon: IconNetwork,
    badgeClass: 'bg-cyan-500/15 text-cyan-400',
    accentClass: 'border-l-cyan-500/50',
  },
  design: {
    label: 'Design',
    hint: 'PRDs, themes, motion, and generative visual assets',
    Icon: IconPencil,
    badgeClass: 'bg-fuchsia-500/15 text-fuchsia-400',
    accentClass: 'border-l-fuchsia-500/50',
  },
  deploy: {
    label: 'Deploy',
    hint: 'Ship verification, npm releases, and launch readiness',
    Icon: IconExport,
    badgeClass: 'bg-orange-500/15 text-orange-400',
    accentClass: 'border-l-orange-500/50',
  },
  data: {
    label: 'Data',
    hint: 'ETL, visualization, and pipeline idempotency',
    Icon: IconStorage,
    badgeClass: 'bg-slate-500/15 text-slate-300',
    accentClass: 'border-l-slate-500/50',
  },
  mobile: {
    label: 'Mobile',
    hint: 'React Native, Capacitor, and emulator workflows',
    Icon: IconBolt,
    badgeClass: 'bg-teal-500/15 text-teal-400',
    accentClass: 'border-l-teal-500/50',
  },
  docs: {
    label: 'Docs',
    hint: 'READMEs, API docs, and co-authored documentation',
    Icon: IconNote,
    badgeClass: 'bg-stone-500/15 text-stone-300',
    accentClass: 'border-l-stone-500/50',
  },
  mushi: {
    label: 'Mushi',
    hint: 'Health checks, setup, and integration smoke tests',
    Icon: IconSkills,
    badgeClass: 'bg-brand/15 text-brand',
    accentClass: 'border-l-brand/50',
  },
  meta: {
    label: 'Meta',
    hint: 'Skill authoring, MCP builders, and agent tooling',
    Icon: IconSliders,
    badgeClass: 'bg-indigo-500/15 text-indigo-400',
    accentClass: 'border-l-indigo-500/50',
  },
  protocol: {
    label: 'Protocol',
    hint: 'Browser anti-stall and automation guardrails',
    Icon: IconShield,
    badgeClass: 'bg-yellow-500/15 text-yellow-400',
    accentClass: 'border-l-yellow-500/50',
  },
  other: {
    label: 'Other',
    hint: 'Uncategorized skills from synced sources',
    Icon: IconMenu,
    badgeClass: 'bg-surface-overlay text-fg-muted',
    accentClass: 'border-l-border',
  },
}

export function getSkillCategoryMeta(category: string): SkillCategoryMeta {
  return SKILL_CATEGORY_META[category] ?? {
    label: category.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    hint: 'Skills from synced sources',
    Icon: IconMenu,
    badgeClass: 'bg-surface-overlay text-fg-muted',
    accentClass: 'border-l-border',
  }
}
