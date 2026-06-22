/**
 * FILE: page-posture-recipes.ts
 * PURPOSE: Canonical PagePosture slot recipes for operator worklist pages.
 *
 * OVERVIEW:
 * - Documents the three standard posture compositions (status-only, status+snapshot, full stack)
 * - Maps each recipe to reference routes and POSTURE_PRIORITY slot ordering
 * - Serves as the Storybook-equivalent catalog (Vitest-rendered in page-posture-recipes.test.tsx)
 *
 * USAGE:
 * - Copy a recipe when adding a new *Page.tsx under apps/admin/src/pages/
 * - Wire slots in priority order; PagePosture enforces per-mode row cap
 *
 * TECHNICAL DETAILS:
 * - Quickstart/Beginner cap: 2 rows · Advanced cap: 3 rows (see PagePosture.tsx)
 */

import { POSTURE_PRIORITY } from '../components/PagePosture'

export type PostureRecipeId = 'status-only' | 'status-snapshot' | 'status-snapshot-guide'

export interface PostureRecipeSlot {
  id: string
  priority: number
  label: string
  /** Typical component suffix for the slot. */
  componentPattern: string
}

export interface PostureRecipe {
  id: PostureRecipeId
  title: string
  referenceRoute: string
  referencePage: string
  maxRowsBeginner: number
  maxRowsAdvanced: number
  slots: PostureRecipeSlot[]
  notes?: string
}

/** Canonical slot recipes — mirror Connect, Audit, and Rewards reference pages. */
export const PAGE_POSTURE_RECIPES: readonly PostureRecipe[] = [
  {
    id: 'status-only',
    title: 'Banner-only posture',
    referenceRoute: '/anti-gaming',
    referencePage: 'AntiGamingPage.tsx',
    maxRowsBeginner: 1,
    maxRowsAdvanced: 1,
    slots: [
      {
        id: 'status',
        priority: POSTURE_PRIORITY.status,
        label: 'Status banner',
        componentPattern: '*StatusBanner',
      },
    ],
    notes: 'Use when no snapshot strip exists yet; still wrap banner in PagePosture for budget enforcement.',
  },
  {
    id: 'status-snapshot',
    title: 'Banner + snapshot strip',
    referenceRoute: '/audit',
    referencePage: 'AuditPage.tsx',
    maxRowsBeginner: 2,
    maxRowsAdvanced: 2,
    slots: [
      {
        id: 'status',
        priority: POSTURE_PRIORITY.status,
        label: 'Status banner',
        componentPattern: '*StatusBanner',
      },
      {
        id: 'snapshot',
        priority: POSTURE_PRIORITY.heroOrSnapshot,
        label: 'Snapshot strip',
        componentPattern: '*SnapshotStrip',
      },
    ],
    notes: 'Default for data-dense worklist pages. Place SegmentedControl after PagePosture.',
  },
  {
    id: 'status-snapshot-guide',
    title: 'Banner + snapshot + guide/readout',
    referenceRoute: '/rewards',
    referencePage: 'RewardsPage.tsx',
    maxRowsBeginner: 2,
    maxRowsAdvanced: 3,
    slots: [
      {
        id: 'status',
        priority: POSTURE_PRIORITY.status,
        label: 'Status banner',
        componentPattern: '*StatusBanner',
      },
      {
        id: 'snapshot',
        priority: POSTURE_PRIORITY.heroOrSnapshot,
        label: 'Snapshot strip',
        componentPattern: '*SnapshotStrip',
      },
      {
        id: 'guide',
        priority: POSTURE_PRIORITY.guide,
        label: 'Guide or readout band',
        componentPattern: '*Guide | *Readout',
      },
    ],
    notes:
      'Hide guide when banner covers the same story via shouldHideGuideWhenBannerActive(). Advanced mode may show all three rows.',
  },
] as const

export function recipeById(id: PostureRecipeId): PostureRecipe | undefined {
  return PAGE_POSTURE_RECIPES.find((r) => r.id === id)
}
