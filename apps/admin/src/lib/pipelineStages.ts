/**
 * Queue / pipeline stage labels → admin pages.
 */

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
    className: 'border-info/35 bg-info-muted/45 text-info hover:bg-info-muted/70',
  },
  fix: {
    label: 'Auto-fix',
    description: 'Fix worker drafts a patch and opens a PR.',
    to: '/fixes',
    className: 'border-accent/35 bg-accent-muted/45 text-accent hover:bg-accent-muted/70',
  },
  judge: {
    label: 'Judge',
    description: 'Quality scoring on classification or fixes.',
    to: '/judge',
    className: 'border-warn/35 bg-warn-muted/45 text-warn hover:bg-warn-muted/70',
  },
  pdca: {
    label: 'PDCA',
    description: 'Iterate loop critiques the draft before merge.',
    to: '/iterate',
    className: 'border-warn/25 bg-warn-muted/35 text-warn hover:bg-warn-muted/55',
  },
  release: {
    label: 'Release',
    description: 'Release notes and changelog builder.',
    to: '/releases',
    className: 'border-ok/35 bg-ok-muted/45 text-ok hover:bg-ok-muted/70',
  },
  intelligence: {
    label: 'Intelligence',
    description: 'Weekly narrative digest.',
    to: '/intelligence',
    className: 'border-brand/35 bg-brand/10 text-brand hover:bg-brand/15',
  },
  qa: {
    label: 'QA story',
    description: 'Scheduled user-story test run.',
    to: '/qa-coverage',
    className: 'border-info/25 bg-info-muted/30 text-info hover:bg-info-muted/50',
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
