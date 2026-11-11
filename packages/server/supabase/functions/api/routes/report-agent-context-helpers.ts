/**
 * FILE: api/routes/report-agent-context-helpers.ts
 * PURPOSE: Pure pieces of the agent-context routes in report-agent-context.ts
 *          (fix context, blast radius). Dependency-free so the
 *          Deno unit tests can import it without env- or DB-touching modules
 *          (same reason ingest-rate-limit.ts is split out).
 */

/** Row shape returned by the get_report_inventory_action RPC (camelCase keys). */
export interface InventoryAnchor {
  nodeId: string;
  label: string | null;
}

/**
 * Read the RPC's jsonb. Until 2026-09-21 the report detail route read
 * `anchor.label` / `anchor.node_id`, keys this RPC never returns, so the fix
 * packet's blast-radius line was always empty.
 */
export function inventoryAnchorOf(raw: unknown): InventoryAnchor | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const nodeId = typeof row.actionNodeId === 'string' ? row.actionNodeId : null;
  if (!nodeId) return null;
  const label = typeof row.actionLabel === 'string' && row.actionLabel.trim() ? row.actionLabel : null;
  return { nodeId, label };
}

/** The one-line blast-radius note composeFixPacket prints for an inventory anchor. */
export function inventoryBlastRadiusNote(anchor: InventoryAnchor | null): string | null {
  if (!anchor?.label) return null;
  return `This report is filed against the "${anchor.label}" user-story action — changes here may affect that flow.`;
}

/**
 * Page-node label for a report URL. Mirrors buildReportGraph in
 * _shared/knowledge-graph.ts, which labels page nodes with the URL pathname.
 */
export function pagePathOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url, 'https://placeholder').pathname || null;
  } catch {
    return null;
  }
}

export type BlastRadiusAnchorKind = 'inventory_action' | 'component' | 'page' | 'report_group';

export interface BlastRadiusAnchor {
  node_id: string;
  node_type: string;
  label: string;
  via: BlastRadiusAnchorKind;
}

export interface AffectedNode {
  target_node_id: string;
  node_type: string;
  label: string;
  min_depth: number;
}

export interface MergedAffectedNode extends AffectedNode {
  /** Which report anchors reach this node. */
  via: BlastRadiusAnchorKind[];
}

/**
 * Union the per-anchor blast radii: one entry per affected node at its
 * shallowest depth, never listing an anchor itself as affected, sorted by
 * depth then label so the output is stable.
 */
export function mergeAffected(
  perAnchor: ReadonlyArray<{ anchor: BlastRadiusAnchor; affected: readonly AffectedNode[] }>,
): MergedAffectedNode[] {
  const anchorIds = new Set(perAnchor.map((p) => p.anchor.node_id));
  const byId = new Map<string, MergedAffectedNode>();
  for (const { anchor, affected } of perAnchor) {
    for (const node of affected) {
      if (anchorIds.has(node.target_node_id)) continue;
      const seen = byId.get(node.target_node_id);
      if (!seen) {
        byId.set(node.target_node_id, { ...node, via: [anchor.via] });
        continue;
      }
      seen.min_depth = Math.min(seen.min_depth, node.min_depth);
      if (!seen.via.includes(anchor.via)) seen.via.push(anchor.via);
    }
  }
  return [...byId.values()].sort((a, b) => a.min_depth - b.min_depth || a.label.localeCompare(b.label));
}
