/**
 * Human-centric alert burndown — pages/tabs upgraded vs remaining.
 * Pattern: headline + hint + primary CTA + optional preview rows.
 */

export type HumanAlertBurndownStatus = 'done' | 'partial' | 'pending'

export interface HumanAlertBurndownItem {
  surface: string
  status: HumanAlertBurndownStatus
  notes: string
}

/** Inventory for rollout tracking — update as pages adopt HumanActionAlert. */
export const HUMAN_ALERTS_BURNDOWN: HumanAlertBurndownItem[] = [
  { surface: 'Projects — bottleneck card', status: 'done', notes: 'ProjectBottleneckCard + failed fix preview' },
  { surface: 'Projects — SDK health', status: 'done', notes: 'Plain language, hide technical table by default' },
  { surface: 'Fixes — status banner + failed summary', status: 'done', notes: 'Primary CTA + deep links' },
  { surface: 'Dashboard — status banner + stats API', status: 'done', notes: 'topPriority + failed_fixes_preview' },
  { surface: 'Reports — status banner', status: 'done', notes: 'Primary CTA + scoped deep links' },
  { surface: 'Health — LLM/cron banners', status: 'done', notes: 'Primary CTA + human hints + scoped URLs' },
  { surface: 'Judge — disagreements banner', status: 'done', notes: 'Filtered deep link + human disagreement copy' },
  { surface: 'QA Coverage — failing stories', status: 'done', notes: 'Primary CTA + qaFailingHint' },
  { surface: 'Queue/DLQ — dead letter', status: 'done', notes: 'Human dead-letter copy + primary CTA' },
  { surface: 'Inbox — open actions', status: 'done', notes: 'Primary Take action CTA' },
  { surface: 'Connect — native CI card', status: 'done', notes: 'Headline/playbook voice aligned with SdkHealthSummary' },
  { surface: 'Integrations — probe failures', status: 'done', notes: 'Primary CTA + integrationIssuesHint' },
  { surface: 'Drift / Code health / Anomalies', status: 'done', notes: 'StatusBannerAction + humanPageHints fallbacks' },
  { surface: 'Active project chip (header)', status: 'done', notes: 'Human chip label + clickable deep link' },
]
