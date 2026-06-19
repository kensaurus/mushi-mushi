/**
 * Plain-language health probes guide (LLM + cron tabs).
 */

export interface HealthProbeTabDefinition {
  id: 'llm' | 'cron' | 'activity'
  label: string
  plain: string
  redMeans: string
}

export const HEALTH_PROBE_TABS: HealthProbeTabDefinition[] = [
  {
    id: 'llm',
    label: 'LLM calls',
    plain: 'Every classification, fix-agent, and judge call — error rate, latency, and BYOK fallback share.',
    redMeans: 'Provider errors or 100% platform fallback — check BYOK keys on Settings → API Keys.',
  },
  {
    id: 'cron',
    label: 'Cron jobs',
    plain: 'Background schedulers (QA runner, sdk-versions sync, drift walker) and their last success time.',
    redMeans: 'A cron missed its window — downstream features (scheduled QA, freshness chips) may stall.',
  },
  {
    id: 'activity',
    label: 'Activity log',
    plain: 'Recent ingest, fix, and webhook events for forensic “what happened at 2am?” debugging.',
    redMeans: 'Use alongside LLM/Cron when a user report does not match probe status.',
  },
]

export const HEALTH_EXPLAINER_SUMMARY =
  'Health shows whether the pipeline backend is reachable: LLM providers responding, cron jobs on schedule, and recent activity flowing. Amber is degraded; red blocks auto-fix or triage.'

export function isHealthGuideExpanded(topPriority: string | undefined): boolean {
  return (
    topPriority === 'no_project' ||
    topPriority === 'llm_errors' ||
    topPriority === 'cron_error' ||
    topPriority === 'llm_fallbacks' ||
    topPriority === 'cron_stale' ||
    topPriority === 'cron_warn'
  )
}

export function healthProbeTab(id: string): HealthProbeTabDefinition | undefined {
  return HEALTH_PROBE_TABS.find((t) => t.id === id)
}
