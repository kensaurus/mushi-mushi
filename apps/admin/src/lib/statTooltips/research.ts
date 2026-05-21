/**
 * FILE: apps/admin/src/lib/statTooltips/research.ts
 * PURPOSE: Human-readable StatCard tooltips for the Research RESEARCH SNAPSHOT strip.
 */

import type { MetricTooltipData } from '../../components/ui'
import type { ResearchStats } from '../../components/research/ResearchStatsTypes'
import { metricTip } from '../metricTooltipBuilder'

export function sessionsTooltip(stats: ResearchStats): MetricTooltipData {
  const takeaway =
    stats.sessions > 0
      ? `${stats.sessions} saved research session${stats.sessions === 1 ? '' : 's'} — reopen History tab to continue investigating.`
      : stats.hasAnyProject
        ? 'No research sessions yet — run a Firecrawl search from Search tab.'
        : 'Select a project to save research sessions.'

  return metricTip(
    'Saved research query sessions (prompt + metadata) for the active project.',
    'Counts research_sessions rows for the project.',
    takeaway,
    stats.sessions === 0 && stats.firecrawlReady
      ? { tone: 'info', text: 'Firecrawl ready — start a search on Search tab.' }
      : undefined,
  )
}

export function sessionsDetail(): string {
  return 'Saved queries'
}

export function snippetsTooltip(stats: ResearchStats): MetricTooltipData {
  const takeaway =
    stats.snippets > 0
      ? `${stats.snippets} web snippet${stats.snippets === 1 ? '' : 's'} captured from Firecrawl searches.`
      : 'No snippets yet — snippets appear after a successful search crawl.'

  return metricTip(
    'Individual web page excerpts returned by Firecrawl and stored for evidence.',
    'Counts research_snippets rows linked to sessions for the active project.',
    takeaway,
  )
}

export function snippetsDetail(): string {
  return 'Web results'
}

export function attachedTooltip(stats: ResearchStats): MetricTooltipData {
  const takeaway =
    stats.attached > 0
      ? `${stats.attached} snippet${stats.attached === 1 ? '' : 's'} attached to bug reports as evidence.`
      : stats.snippets > 0
        ? 'Snippets exist but none attached to reports — link snippets with a report UUID.'
        : 'No attached evidence yet.'

  return metricTip(
    'Research snippets linked to a bug report as supporting evidence.',
    'Counts research_snippets where report_id is non-null.',
    takeaway,
  )
}

export function attachedDetail(): string {
  return 'Report evidence'
}

export function unattachedSnippetsTooltip(stats: ResearchStats): MetricTooltipData {
  const takeaway =
    stats.unattachedSnippets > 0
      ? `${stats.unattachedSnippets} snippet${stats.unattachedSnippets === 1 ? '' : 's'} need a report UUID — attach from History before the session goes stale.`
      : 'All snippets are attached or none exist yet.'

  return metricTip(
    'Snippets not yet linked to a bug report (missing report UUID).',
    'Counts research_snippets where report_id is null for the active project.',
    takeaway,
    stats.unattachedSnippets > 0
      ? { tone: 'warn', text: `${stats.unattachedSnippets} unattached — paste report UUID to preserve evidence.` }
      : undefined,
  )
}

export function unattachedSnippetsDetail(): string {
  return 'Need report UUID'
}

export function firecrawlTooltip(stats: ResearchStats): MetricTooltipData {
  const takeaway =
    stats.firecrawlReady
      ? 'Firecrawl BYOK key verified — searches will execute against allowed domains.'
      : stats.firecrawlConfigured
        ? 'Key saved but not verified — run Test connection in Settings → API Keys.'
        : 'Configure BYOK Firecrawl key in Settings before running web research.'

  return metricTip(
    'Firecrawl integration readiness: Setup (no key), Test (key saved), Ready (probe passed).',
    'Reads mushi_runtime_config BYOK_FIRECRAWL_API_KEY and last firecrawl_test_status probe result.',
    takeaway,
    !stats.firecrawlReady && stats.hasAnyProject
      ? { tone: 'info', text: stats.firecrawlKeyHint ?? 'Add BYOK Firecrawl key in Settings.' }
      : undefined,
  )
}

export function firecrawlDetail(stats: ResearchStats): string {
  return stats.firecrawlKeyHint ?? 'BYOK in Settings'
}

export function domainsTooltip(stats: ResearchStats): MetricTooltipData {
  const takeaway =
    stats.allowedDomainsCount > 0
      ? `${stats.allowedDomainsCount} allowed domain${stats.allowedDomainsCount === 1 ? '' : 's'} · up to ${stats.maxPagesPerCall} pages per Firecrawl call.`
      : 'No allow-list domains — add domains in project settings before crawling production sites.'

  return metricTip(
    'Domains permitted for Firecrawl crawls, and the per-call page limit.',
    'allowedDomainsCount from project research config; maxPagesPerCall from runtime limits.',
    takeaway,
    stats.allowedDomainsCount === 0 && stats.firecrawlReady
      ? { tone: 'info', text: 'Add allowed domains before searching external sites.' }
      : undefined,
  )
}

export function domainsDetail(stats: ResearchStats): string {
  return `${stats.maxPagesPerCall} pages/call`
}
