/**
 * Queue / pipeline stage labels → admin pages.
 */

import { CHIP_TONE } from './chipTone'

export interface PipelineStageInfo {
  label: string
  description: string
  to: string
  className: string
}

const STAGES: Record<string, PipelineStageInfo> = {
  classify: {
    label: 'Classify',
    description: 'LLM triage assigns category and severity.',
    to: '/reports',
    className: `${CHIP_TONE.infoSubtle} hover:bg-info-muted/70`,
  },
  fix: {
    label: 'Auto-fix',
    description: 'Fix worker drafts a patch and opens a PR.',
    to: '/fixes',
    className: `${CHIP_TONE.accentSubtle} hover:bg-accent-muted/70`,
  },
  judge: {
    label: 'Judge',
    description: 'Quality scoring on classification or fixes.',
    to: '/judge',
    className: `${CHIP_TONE.warnSubtle} hover:bg-warn-muted/70`,
  },
  pdca: {
    label: 'PDCA',
    description: 'Iterate loop critiques the draft before merge.',
    to: '/iterate',
    className: `${CHIP_TONE.warnSubtle} hover:bg-warn-muted/55`,
  },
  release: {
    label: 'Release',
    description: 'Release notes and changelog builder.',
    to: '/releases',
    className: `${CHIP_TONE.okSubtle} hover:bg-ok-muted/70`,
  },
  intelligence: {
    label: 'Intelligence',
    description: 'Weekly narrative digest.',
    to: '/intelligence',
    className: `${CHIP_TONE.brandSubtle} hover:bg-brand/15`,
  },
  qa: {
    label: 'QA story',
    description: 'Scheduled user-story test run.',
    to: '/qa-coverage',
    className: `${CHIP_TONE.infoSubtle} hover:bg-info-muted/50`,
  },
}

const DEFAULT_STAGE: PipelineStageInfo = {
  label: 'Pipeline',
  description: 'Processing step in the bug-fix loop.',
  to: '/queue',
  className: 'border-edge bg-surface-overlay text-fg-muted hover:bg-surface-overlay/80',
}

export function resolvePipelineStage(stage: string): PipelineStageInfo {
  const key = stage.trim().toLowerCase()
  return STAGES[key] ?? { ...DEFAULT_STAGE, label: stage }
}
