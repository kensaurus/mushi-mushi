/**
 * FILE: apps/admin/src/lib/statTooltips/graph.ts
 * PURPOSE: Human-readable StatCard tooltips for the Graph GRAPH SNAPSHOT strip.
 */

export type { PlainStatTooltipOpts } from '../usePlainStatTooltips'

import type { MetricTooltipData } from '../../components/ui'
import type { GraphStats } from '../../components/graph/GraphStatsTypes'
import { metricTip } from '../metricTooltipBuilder'

export function nodesTooltip(stats: GraphStats): MetricTooltipData {
  const takeaway =
    stats.nodeCount > 0
      ? `${stats.nodeCount.toLocaleString()} nodes mapped${stats.reportNodes > 0 ? `, including ${stats.reportNodes} report-group nodes from classified bugs` : ''}. Explore tab for blast-radius navigation.`
      : stats.hasIngest
        ? 'Reports ingested but graph is empty — classifier may still be seeding nodes from recent triage.'
        : 'Graph seeds from classified bug reports — send ingest first, then triage reports to populate nodes.'

  return metricTip(
    'Total knowledge-graph nodes for the active project.',
    'Counts graph_nodes rows (sampled up to 500). reportNodes is the subset with node_type report_group, created when reports are classified.',
    takeaway,
    stats.hasIngest && stats.nodeCount === 0
      ? { tone: 'info', text: 'Reports exist but graph is empty — check classifier output on Reports → Queue.' }
      : undefined,
  )
}

export function nodesDetail(stats: GraphStats): string {
  return stats.reportNodes > 0 ? `${stats.reportNodes} report groups` : 'Seeds from reports'
}

export function edgesTooltip(stats: GraphStats): MetricTooltipData {
  const takeaway =
    stats.edgeCount > 0
      ? `${stats.edgeCount.toLocaleString()} relationships${stats.duplicateEdges > 0 ? `, including ${stats.duplicateEdges} duplicate_of links` : ''}${stats.regressionEdges > 0 ? ` and ${stats.regressionEdges} regression edges` : ''}.`
      : 'No edges yet — relationships appear when reports link components, regressions, or fixes.'

  return metricTip(
    'Relationships between graph nodes (affects, regression_of, duplicate_of, fix_verified, etc.).',
    'Counts graph_edges rows (sampled up to 1000) for the active project.',
    takeaway,
    stats.duplicateEdges > 5
      ? { tone: 'info', text: `${stats.duplicateEdges} duplicate_of edges — consider deduping noisy report clusters.` }
      : stats.regressionEdges > 0
        ? { tone: 'warn', text: `${stats.regressionEdges} regression edge${stats.regressionEdges === 1 ? '' : 's'} — bugs that returned after a fix.` }
        : undefined,
  )
}

export function edgesDetail(stats: GraphStats): string {
  return stats.duplicateEdges > 0 ? `${stats.duplicateEdges} duplicates` : 'Relationship count'
}

export function fragileTooltip(stats: GraphStats): MetricTooltipData {
  const takeaway =
    stats.fragileComponents > 0
      ? `${stats.fragileComponents} component${stats.fragileComponents === 1 ? '' : 's'} have three or more incoming affects edges — high blast-radius hotspots where many bugs land.`
      : 'No components flagged as fragile — nothing has ≥3 incoming affects edges yet.'

  return metricTip(
    'Code components with high blast radius — three or more incoming affects edges from bug reports.',
    'For each component node, counts affects edges targeting it. Components with count ≥ 3 are fragile.',
    takeaway,
    stats.fragileComponents > 0
      ? {
          tone: 'warn',
          text: `${stats.fragileComponents} fragile component${stats.fragileComponents === 1 ? '' : 's'} — prioritize hardening or test coverage here.`,
        }
      : undefined,
  )
}

export function fragileDetail(plainBanner?: boolean): string {
  return plainBanner ? 'Many bugs land here' : 'Components with ≥3 affects'
}

export function inventoryTooltip(stats: GraphStats): MetricTooltipData {
  const takeaway =
    stats.inventoryNodes > 0
      ? `${stats.inventoryNodes.toLocaleString()} inventory overlay nodes (pages, elements, user stories, API deps) enrich the graph beyond raw report clusters.`
      : 'No inventory overlay yet — run the inventory crawler or enable User stories to map app surfaces on the graph.'

  return metricTip(
    'Surface-map nodes from the inventory crawler (pages, elements, actions, user stories, API/DB deps).',
    'Counts graph_nodes whose node_type is in the inventory set: app, page_v2, element, action, api_dep, db_dep, test, user_story.',
    takeaway,
    stats.inventoryNodes === 0 && stats.hasIngest
      ? { tone: 'info', text: 'Enable User stories or run inventory crawl to overlay app surfaces on the graph.' }
      : undefined,
  )
}

export function inventoryDetail(stats: GraphStats): string {
  return stats.inventoryNodes > 0 ? 'Surface overlay nodes' : 'Enable via User stories'
}
