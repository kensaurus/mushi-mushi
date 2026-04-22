export const SEVERITY: Record<string, string> = {
  critical: 'bg-danger-muted text-danger border border-danger/20',
  high:     'bg-warn-muted text-warn border border-warn/20',
  medium:   'bg-warn-muted/60 text-warn/80 border border-warn/15',
  low:      'bg-info-muted text-info border border-info/20',
}

export const STATUS: Record<string, string> = {
  new:        'bg-warn-muted text-warn border border-warn/20',
  classified: 'bg-ok-muted text-ok border border-ok/20',
  fixing:     'bg-accent-muted text-accent border border-accent/20',
  fixed:      'bg-info-muted text-info border border-info/20',
  dismissed:  'bg-surface-overlay text-fg-muted border border-edge-subtle',
}

export const PIPELINE_STATUS: Record<string, string> = {
  pending:    'bg-warn-muted text-warn',
  running:    'bg-info-muted text-info',
  exporting:  'bg-info-muted text-info',
  exported:   'bg-info-muted text-info',
  training:   'bg-accent-muted text-accent',
  trained:    'bg-accent-muted text-accent',
  validating: 'bg-info-muted text-info',
  validated:  'bg-ok-muted text-ok',
  promoted:   'bg-ok-muted text-ok',
  rejected:   'bg-danger-muted text-danger',
  completed:         'bg-ok-muted text-ok',
  failed:            'bg-danger-muted text-danger',
  error:             'bg-danger-muted text-danger',
  dead_letter:       'bg-danger-muted text-danger',
  skipped:                    'bg-warn-muted text-warn',
  skipped_no_context:         'bg-warn-muted text-warn',
  skipped_no_sandbox:         'bg-warn-muted text-warn',
  skipped_unsupported_agent:  'bg-warn-muted text-warn',
}

export const CATEGORY_LABELS: Record<string, string> = {
  bug:       'Bug',
  slow:      'Slow',
  visual:    'Visual',
  confusing: 'Confusing UX',
  other:     'Other',
}

export const STATUS_LABELS: Record<string, string> = {
  new:        'New',
  classified: 'Classified',
  fixing:     'Fixing',
  fixed:      'Fixed',
  dismissed:  'Dismissed',
}

export const SEVERITY_LABELS: Record<string, string> = {
  critical: 'Critical',
  high:     'High',
  medium:   'Medium',
  low:      'Low',
}

export const PIPELINE_STATUS_LABELS: Record<string, string> = {
  pending:     'Pending',
  running:     'Running',
  exporting:   'Exporting',
  exported:    'Exported',
  training:    'Training',
  trained:     'Trained',
  validating:  'Validating',
  validated:   'Validated',
  promoted:    'Promoted',
  rejected:    'Rejected',
  completed:          'Completed',
  failed:             'Failed',
  error:              'Error',
  dead_letter:        'Dead letter',
  skipped:                   'Skipped',
  skipped_no_context:        'Skipped (no context)',
  skipped_no_sandbox:        'Skipped (no sandbox)',
  skipped_unsupported_agent: 'Skipped (unsupported agent)',
}

export function statusLabel(s: string | null | undefined): string {
  if (!s) return 'Unset'
  return STATUS_LABELS[s] ?? s
}

export function severityLabel(s: string | null | undefined): string {
  if (!s) return 'Unset'
  return SEVERITY_LABELS[s] ?? s
}

export function pipelineStatusLabel(s: string | null | undefined): string {
  if (!s) return '—'
  return PIPELINE_STATUS_LABELS[s] ?? s
}

export const FILTER_OPTIONS = {
  categories: ['', 'bug', 'slow', 'visual', 'confusing', 'other'],
  statuses:   ['', 'new', 'classified', 'fixing', 'fixed', 'dismissed'],
  severities: ['', 'critical', 'high', 'medium', 'low'],
} as const

export const NODE_COLORS: Record<string, string> = {
  report_group: 'oklch(0.65 0.22 25)',
  component:    'oklch(0.68 0.16 240)',
  page:         'oklch(0.72 0.19 155)',
  version:      'oklch(0.80 0.15 80)',
}

export const SCORE_COLORS: Record<string, string> = {
  overall:   'oklch(0.58 0.22 280)',
  accuracy:  'oklch(0.68 0.16 240)',
  severity:  'oklch(0.65 0.22 25)',
  component: 'oklch(0.72 0.19 155)',
  repro:     'oklch(0.80 0.15 80)',
}
