/**
 * FILE: api/routes/report-agent-context-helpers.ts
 * PURPOSE: Pure pieces of the agent-context routes in report-agent-context.ts
 *          (fix context, blast radius, repo bootstrap). Dependency-free so the
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

// ─── Repo bootstrap ──────────────────────────────────────────────────────────

export interface LessonRow {
  id: string;
  rule_text: string;
  anti_pattern?: string | null;
  severity: string;
  frequency: number;
  last_reinforced_at?: string | null;
  cluster_id?: string | null;
}

export interface RepoBootstrapFile {
  /** Relative to the repository root, forward slashes. */
  path: string;
  content: string;
}

/**
 * The three files `setup_repo_for_mushi` promises: `.cursorrules`,
 * `.mushi/lessons.json` and `MUSHI.md`. An edge function cannot write into the
 * caller's checkout, so the route returns them for the agent to write.
 * `.mushi/lessons.json` has the exact shape `mushi sync-lessons` writes
 * (packages/cli/src/commands/lessons.ts) so either tool can refresh it, and
 * the rules text matches `mushi setup --with-rules`.
 *
 * Lesson text is never copied into `.cursorrules` or `MUSHI.md`. Lessons are
 * distilled from end-user reports, and those two files are loaded by the
 * editor agent as standing instructions; the JSON is data the agent reads on
 * demand.
 */
export function buildRepoBootstrapFiles(input: {
  projectId: string;
  projectName: string;
  lessons: readonly LessonRow[];
  generatedAt: string;
}): RepoBootstrapFile[] {
  const lessonsJson = {
    schema_version: '1',
    project_id: input.projectId,
    generated_at: input.generatedAt,
    lessons: input.lessons.map((l) => ({
      id: l.id,
      rule: l.rule_text,
      anti_pattern: l.anti_pattern ?? undefined,
      severity: l.severity,
      frequency: l.frequency,
      last_reinforced: l.last_reinforced_at?.slice(0, 10) ?? '',
      cluster_id: l.cluster_id ?? undefined,
    })),
  };

  const cursorRules = [
    '# Mushi Mushi — evolution-loop coding rules',
    '#',
    "# These rules are generated from your project's live lesson library.",
    '# Run `mushi sync-lessons` to refresh .mushi/lessons.json',
    '# The MCP server (mushi tools) also injects lessons dynamically at fix time.',
    '',
    '## Before writing a fix',
    '',
    '1. Call `get_fix_context` (MCP) for the report — get root cause + blast radius first.',
    '2. Call `list_lessons` (MCP) or read .mushi/lessons.json — apply every matching rule.',
    "3. Prefer the smallest change that makes the test pass. Don't refactor unrelated code.",
    '',
    '## After writing a fix',
    '',
    '1. Call `submit_fix_result` (MCP) with the branch, PR URL, and files changed.',
    '2. The judge batch will score the fix overnight — high-frequency lessons surface in /admin/lessons.',
    '',
    '## Mushi lesson library (auto-updated by `mushi sync-lessons`)',
    '',
    '<!-- lessons synced from .mushi/lessons.json -->',
    '<!-- run `mushi sync-lessons` to refresh -->',
    '',
  ].join('\n');

  const mushiMd = [
    `# ${oneLine(input.projectName)} — Mushi Mushi`,
    '',
    'This repository reports user-felt bugs to Mushi Mushi. Mushi turns each report into a',
    'diagnosis and a fix context an agent can act on. This file is the contract for agents',
    'working in this repo.',
    '',
    `- Project ID: \`${input.projectId}\``,
    `- Lessons: \`.mushi/lessons.json\` (${input.lessons.length} promoted, generated ${input.generatedAt.slice(0, 10)})`,
    '- Rules: `.cursorrules`',
    '',
    '## Fixing a Mushi report',
    '',
    '1. `get_fix_context` for the report: root cause, reproduction steps, relevant files.',
    '2. `get_blast_radius` when the report names a component, so the fix does not break a neighbour.',
    '3. Check `.mushi/lessons.json` (or `query_lessons` with your diff) before you finish.',
    '4. `submit_fix_result` with the branch, PR URL and files changed.',
    '',
    '## Keeping this current',
    '',
    '- `npx @mushi-mushi/cli sync-lessons` refreshes `.mushi/lessons.json` (run it in CI).',
    '- Re-run `setup_repo_for_mushi` to regenerate all three files.',
    '',
  ].join('\n');

  return [
    { path: '.cursorrules', content: cursorRules },
    { path: '.mushi/lessons.json', content: JSON.stringify(lessonsJson, null, 2) + '\n' },
    { path: 'MUSHI.md', content: mushiMd },
  ];
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
