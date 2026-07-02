/**
 * LLM operation / function registry — colors, ELI5 copy, and cross-page links.
 */

import { CHIP_TONE } from './chipTone'

export type OperationCategory =
  | 'ingest'
  | 'fix'
  | 'iterate'
  | 'release'
  | 'intel'
  | 'lessons'
  | 'qa'
  | 'ops'
  | 'other'

export interface OperationInfo {
  label: string
  category: OperationCategory
  description: string
  to: string
  healthFn?: string
}

export const OPERATION_CATEGORY_CLASS: Record<OperationCategory, string> = {
  ingest: `${CHIP_TONE.infoSubtle} hover:bg-info-muted/70`,
  fix: `${CHIP_TONE.accentSubtle} hover:bg-accent-muted/70`,
  iterate: `${CHIP_TONE.warnSubtle} hover:bg-warn-muted/70`,
  release: `${CHIP_TONE.okSubtle} hover:bg-ok-muted/70`,
  intel: 'border-brand/35 bg-brand/10 text-brand hover:bg-brand/15',
  lessons: 'border-accent/25 bg-surface-overlay text-fg-secondary hover:bg-surface-overlay/80',
  qa: `border-info/25 ${CHIP_TONE.infoSubtle} hover:bg-info-muted/50`,
  ops: 'border-edge bg-surface-overlay text-fg-muted hover:bg-surface-overlay/80',
  other: 'border-edge-subtle bg-surface-overlay/60 text-fg-muted hover:bg-surface-overlay',
}

const EXACT: Record<string, OperationInfo> = {
  'fast-filter:stage1': {
    label: 'Fast filter',
    category: 'ingest',
    description: 'Cheap first pass that drops spam and obvious non-bugs before full classification.',
    to: '/reports',
    healthFn: 'fast-filter',
  },
  'classify-report:stage2': {
    label: 'Classify report',
    category: 'ingest',
    description: 'Reads the user report and assigns category, severity, and routing for the fix pipeline.',
    to: '/reports',
    healthFn: 'classify-report',
  },
  'pdca-iteration': {
    label: 'PDCA critique',
    category: 'iterate',
    description: 'Plan–Do–Check–Act loop that scores and critiques a draft fix before merge.',
    to: '/iterate',
    healthFn: 'pdca-runner',
  },
  'release-builder': {
    label: 'Release notes',
    category: 'release',
    description: 'Drafts changelog copy and credits reporters for a release window.',
    to: '/releases',
    healthFn: 'release-builder',
  },
  'lesson-summarise': {
    label: 'Lesson summary',
    category: 'lessons',
    description: 'Turns a cluster of similar bugs into a reusable lesson for the team.',
    to: '/lessons',
    healthFn: 'mistake-summarizer',
  },
  'cluster-coherence': {
    label: 'Cluster coherence',
    category: 'lessons',
    description: 'Checks whether grouped bugs really belong in the same lesson cluster.',
    to: '/lessons',
    healthFn: 'mistake-clusterer',
  },
  'intelligence-report:digest': {
    label: 'Weekly digest',
    category: 'intel',
    description: 'LLM narrative for the intelligence report — trends and highlights.',
    to: '/intelligence',
    healthFn: 'intelligence-report',
  },
}

const BY_FUNCTION: Record<string, OperationInfo> = {
  'fast-filter': EXACT['fast-filter:stage1'],
  'classify-report': EXACT['classify-report:stage2'],
  'fix-worker': {
    label: 'Auto-fix',
    category: 'fix',
    description: 'Writes a code patch and opens a pull request for a triaged bug.',
    to: '/fixes',
    healthFn: 'fix-worker',
  },
  'judge-batch': {
    label: 'Judge batch',
    category: 'fix',
    description: 'Scores fix quality and classification agreement on a schedule.',
    to: '/judge',
    healthFn: 'judge-batch',
  },
  'test-gen-from-report': {
    label: 'Test from report',
    category: 'qa',
    description: 'Generates a Playwright user-story test from a real bug report.',
    to: '/qa-coverage',
    healthFn: 'test-gen-from-report',
  },
  'qa-story-runner': {
    label: 'QA story runner',
    category: 'qa',
    description: 'Runs scheduled user-story checks against your live app.',
    to: '/qa-coverage',
    healthFn: 'qa-story-runner',
  },
  'inventory-propose': {
    label: 'Inventory propose',
    category: 'ops',
    description: 'Proposes user-story nodes from crawl data for your app map.',
    to: '/inventory',
    healthFn: 'inventory-propose',
  },
  'inventory-crawler': {
    label: 'Route crawler',
    category: 'ops',
    description: 'Crawls routes to populate the inventory graph.',
    to: '/inventory',
    healthFn: 'inventory-crawler',
  },
  'pdca-runner': EXACT['pdca-iteration'],
  'release-builder': EXACT['release-builder'],
  'intelligence-report': EXACT['intelligence-report:digest'],
  'mistake-clusterer': EXACT['cluster-coherence'],
  'mistake-summarizer': EXACT['lesson-summarise'],
}

function fallback(key: string): OperationInfo {
  const base = key.split(':')[0] ?? key
  const fromFn = BY_FUNCTION[base]
  if (fromFn) {
    return {
      ...fromFn,
      label: key.includes(':')
        ? `${fromFn.label} (${key.split(':').slice(1).join(':')})`
        : fromFn.label,
    }
  }
  return {
    label: key,
    category: 'other',
    description: 'LLM or pipeline step. Open Health to see recent calls for this name.',
    to: `/health?fn=${encodeURIComponent(base)}`,
    healthFn: base,
  }
}

export function resolveOperation(key: string): OperationInfo {
  const k = key.trim()
  if (!k) return fallback('unknown')
  return EXACT[k] ?? BY_FUNCTION[k] ?? fallback(k)
}

export function operationLinkTo(info: OperationInfo): string {
  return info.to
}
