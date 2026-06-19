/**
 * Plain-language code health (bundle + god-file) guide.
 */

export interface CodeHealthMetricDefinition {
  id: string
  label: string
  plain: string
  source: string
}

export const CODE_HEALTH_METRIC_DEFINITIONS: CodeHealthMetricDefinition[] = [
  {
    id: 'bundle',
    label: 'Bundle size (KB)',
    plain: 'Gzip size of your mobile/web JS bundle on each CI push — trending up means users download more code.',
    source: 'Host repo CI → POST /v1/ingest/metrics (bundle.* metrics)',
  },
  {
    id: 'god_file',
    label: 'God file (2,000+ LOC)',
    plain:
      'A single source file grew past the maintainability budget. Large files slow reviews and hide bugs — split by feature domain.',
    source: 'scan-god-files.mjs in bundle-budget.yml → code_health gate findings',
  },
  {
    id: 'ingest',
    label: 'CI ingest key',
    plain: 'Mint MUSHI_INGEST_KEY on Projects and add it to GitHub Actions secrets so pushes appear here automatically.',
    source: 'Connect → Native app CI secrets or Projects → SDK ingest key',
  },
]

export const CODE_HEALTH_EXPLAINER_SUMMARY =
  'Code Health tracks bundle KB trends and oversized source files pushed from your repo CI. It is read-only here — fixes happen in your codebase, then the next green CI push updates the chart.'

export function isCodeHealthGuideExpanded(topPriority: string | undefined): boolean {
  return (
    topPriority === 'no_project' ||
    topPriority === 'no_data' ||
    topPriority === 'errors' ||
    topPriority === 'warnings'
  )
}

export function codeHealthMetricDefinition(id: string): CodeHealthMetricDefinition | undefined {
  return CODE_HEALTH_METRIC_DEFINITIONS.find((m) => m.id === id)
}
