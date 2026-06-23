/**
 * Visual + copy metadata for cursor-kenji skill categories.
 * Used by SkillPipelinesPage catalog headers and skill cards.
 *
 * Badge/accent classes use admin @theme semantic tokens only (no raw Tailwind
 * palette) so category chips stay WCAG-safe and theme-consistent.
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
    badgeClass: 'bg-accent-muted text-accent-foreground',
    accentClass: 'border-l-accent/50',
  },
  debug: {
    label: 'Debug',
    hint: 'Reproduce, isolate, and fix errors with production context',
    Icon: IconTerminal,
    badgeClass: 'bg-warn-muted text-warn-foreground',
    accentClass: 'border-l-warn/50',
  },
  test: {
    label: 'Test',
    hint: 'Playwright sweeps, QA coverage, and adversarial red-team',
    Icon: IconPlay,
    badgeClass: 'bg-ok-muted text-ok-foreground',
    accentClass: 'border-l-ok/50',
  },
  audit: {
    label: 'Audit',
    hint: 'Security, accessibility, performance, and design-system checks',
    Icon: IconAudit,
    badgeClass: 'bg-info-muted text-info-foreground',
    accentClass: 'border-l-info/50',
  },
  enhance: {
    label: 'Enhance',
    hint: 'Polish UI, UX, SEO, PWA, and post-launch iteration',
    Icon: IconSliders,
    badgeClass: 'bg-rose-muted text-rose',
    accentClass: 'border-l-rose/50',
  },
  backend: {
    label: 'Backend',
    hint: 'API design, observability, error handling, and data pipelines',
    Icon: IconNetwork,
    badgeClass: 'bg-info-muted text-info-foreground',
    accentClass: 'border-l-info/50',
  },
  design: {
    label: 'Design',
    hint: 'PRDs, themes, motion, and generative visual assets',
    Icon: IconPencil,
    badgeClass: 'bg-accent-muted text-accent-foreground',
    accentClass: 'border-l-accent/50',
  },
  deploy: {
    label: 'Deploy',
    hint: 'Ship verification, npm releases, and launch readiness',
    Icon: IconExport,
    badgeClass: 'bg-warn-muted text-warn-foreground',
    accentClass: 'border-l-warn/50',
  },
  data: {
    label: 'Data',
    hint: 'ETL, visualization, and pipeline idempotency',
    Icon: IconStorage,
    badgeClass: 'bg-surface-overlay text-fg-muted',
    accentClass: 'border-l-edge-subtle',
  },
  mobile: {
    label: 'Mobile',
    hint: 'React Native, Capacitor, and emulator workflows',
    Icon: IconBolt,
    badgeClass: 'bg-ok-muted text-ok-foreground',
    accentClass: 'border-l-ok/50',
  },
  docs: {
    label: 'Docs',
    hint: 'READMEs, API docs, and co-authored documentation',
    Icon: IconNote,
    badgeClass: 'bg-surface-overlay text-fg-secondary',
    accentClass: 'border-l-edge-subtle',
  },
  mushi: {
    label: 'Mushi',
    hint: 'Health checks, setup, and integration smoke tests',
    Icon: IconSkills,
    badgeClass: 'bg-brand-subtle text-brand-foreground',
    accentClass: 'border-l-brand/50',
  },
  meta: {
    label: 'Meta',
    hint: 'Skill authoring, MCP builders, and agent tooling',
    Icon: IconSliders,
    badgeClass: 'bg-accent-muted text-accent-foreground',
    accentClass: 'border-l-accent/50',
  },
  protocol: {
    label: 'Protocol',
    hint: 'Browser anti-stall and automation guardrails',
    Icon: IconShield,
    badgeClass: 'bg-warn-muted text-warn-foreground',
    accentClass: 'border-l-warn/50',
  },
  other: {
    label: 'Other',
    hint: 'Uncategorized skills from synced sources',
    Icon: IconMenu,
    badgeClass: 'bg-surface-overlay text-fg-muted',
    accentClass: 'border-l-edge-subtle',
  },
}

export function getSkillCategoryMeta(category: string): SkillCategoryMeta {
  return SKILL_CATEGORY_META[category] ?? {
    label: category.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    hint: 'Skills from synced sources',
    Icon: IconMenu,
    badgeClass: 'bg-surface-overlay text-fg-muted',
    accentClass: 'border-l-edge-subtle',
  }
}
