/**
 * FILE: apps/admin/src/lib/statTooltips/explore.ts
 * PURPOSE: Human-readable StatCard tooltips for the Explore EXPLORE SNAPSHOT strip.
 */

import type { MetricTooltipData } from '../../components/ui'
import type { ExploreStats } from '../../components/explore/ExploreStatsTypes'
import { metricTip } from '../metricTooltipBuilder'

export function indexedFilesTooltip(stats: ExploreStats): MetricTooltipData {
  const takeaway =
    stats.indexedFiles > 0
      ? `${stats.indexedFiles.toLocaleString()} files indexed${stats.repoUrl ? ` from ${stats.repoUrl.split('/').slice(-2).join('/')}.` : '.'} Use Search tab for semantic queries.`
      : stats.repoUrl
        ? 'Repo connected but no files indexed yet — trigger Index tab or wait for webhook ingest.'
        : stats.hasAnyProject
          ? 'Connect a GitHub repo in Settings → Codebase Indexing to populate the graph.'
          : 'Select a project to index a codebase.'

  return metricTip(
    'Number of source files stored in the codebase index for the active project.',
    'Counts project_codebase_files rows for the project (one row per indexed file path).',
    takeaway,
    stats.indexedFiles === 0 && stats.hasAnyProject && !stats.repoUrl
      ? { tone: 'info', text: 'Connect a repo — open Index tab to start indexing.' }
      : undefined,
  )
}

export function indexedFilesDetail(stats: ExploreStats): string {
  return stats.repoUrl ? 'Indexed file rows' : 'Connect a repo'
}

export function uiLayerTooltip(stats: ExploreStats): MetricTooltipData {
  const count = stats.layers?.ui ?? 0
  const takeaway =
    count > 0
      ? `${count.toLocaleString()} UI-layer files (components, pages, screens) — browse Layers tab for the full breakdown.`
      : 'No UI-layer files detected — index may be empty or paths do not match ui heuristics.'

  return metricTip(
    'Indexed files classified as UI layer: components, pages, screens, and JSX/TSX under app/ or pages/.',
    'detectExploreLayer heuristic on project_codebase_files — directories like app/, pages/, screens/, components/.',
    takeaway,
  )
}

export function uiLayerDetail(): string {
  return 'Components, pages, screens'
}

export function backendLayerTooltip(stats: ExploreStats): MetricTooltipData {
  const count = stats.layers?.backend ?? 0
  const takeaway =
    count > 0
      ? `${count.toLocaleString()} backend-layer files — API routes, edge functions, and server modules.`
      : 'No backend-layer files in the index — verify supabase/functions/ and api/ paths are present.'

  return metricTip(
    'Indexed files classified as backend: API routes, edge functions, server/, routes/, supabase/functions/.',
    'detectExploreLayer heuristic on project_codebase_files for backend directories and extensions.',
    takeaway,
  )
}

export function backendLayerDetail(): string {
  return 'API routes, edge functions'
}

export function embeddingsTooltip(stats: ExploreStats): MetricTooltipData {
  const takeaway =
    stats.withEmbeddings > 0
      ? `${stats.withEmbeddings.toLocaleString()} files have embedding vectors — semantic search is ready on Search tab.`
      : stats.indexedFiles > 0
        ? 'Files indexed but embeddings missing — re-run indexing with embeddings enabled.'
        : 'No embeddings yet — index files first, then generate vectors for semantic search.'

  return metricTip(
    'Indexed files that have a vector embedding for semantic codebase search.',
    'Counts project_codebase_files rows where embedding column is non-null (match_codebase_files RPC input).',
    takeaway,
    stats.withEmbeddings === 0 && stats.indexedFiles > 0
      ? { tone: 'warn', text: 'Index exists without embeddings — semantic search will be empty.' }
      : undefined,
  )
}

export function embeddingsDetail(): string {
  return 'Vectors for semantic search'
}
