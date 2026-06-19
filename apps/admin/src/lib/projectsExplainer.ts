/**
 * Plain-language projects hub guide.
 */

export const PROJECTS_EXPLAINER_SUMMARY =
  'Each project is one app or environment Mushi watches. You need an API key heartbeat (SDK connected) and at least one ingested bug report before the full PDCA loop lights up.'

export interface ProjectsHealthSignalDefinition {
  id: string
  label: string
  plain: string
}

export const PROJECTS_HEALTH_SIGNALS: ProjectsHealthSignalDefinition[] = [
  {
    id: 'ingest',
    label: 'Ingesting reports',
    plain: 'The SDK or Sentry bridge successfully posted at least one bug to this project.',
  },
  {
    id: 'sdk',
    label: 'SDK heartbeat',
    plain: 'An active API key was seen recently from your app bundle or dev server.',
  },
  {
    id: 'github',
    label: 'GitHub linked',
    plain: 'Required for auto-fix PRs and SDK upgrade jobs — connect on Connect or Integrations.',
  },
  {
    id: 'index',
    label: 'Codebase index',
    plain: 'Optional but recommended — lets Explore map symbols and gives fix-agent repo context.',
  },
]

export function isProjectsGuideExpanded(topPriority: string | undefined): boolean {
  return (
    topPriority === 'no_projects' ||
    topPriority === 'never_ingested' ||
    topPriority === 'no_sdk_heartbeat' ||
    topPriority === 'partial_ingest'
  )
}

export function projectsHealthSignal(id: string): ProjectsHealthSignalDefinition | undefined {
  return PROJECTS_HEALTH_SIGNALS.find((s) => s.id === id)
}
