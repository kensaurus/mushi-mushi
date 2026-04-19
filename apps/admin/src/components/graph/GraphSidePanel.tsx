/**
 * FILE: apps/admin/src/components/graph/GraphSidePanel.tsx
 * PURPOSE: Detail card for a selected graph node — metadata, related-reports
 *          link, and the computed blast radius. Handles its own empty/loading
 *          states so the page doesn't have to branch on `node === null`.
 */

import { Link } from 'react-router-dom'
import { Badge, Card, RelativeTime } from '../ui'
import { NODE_COLORS } from '../../lib/tokens'
import {
  nodeMetadataValue,
  NODE_TYPE_LABELS,
  type BlastRadiusItem,
  type GraphNode,
} from './types'

interface Props {
  node: GraphNode | null
  blastRadius: BlastRadiusItem[]
  blastLoading: boolean
  onClear: () => void
}

export function GraphSidePanel({ node, blastRadius, blastLoading, onClear }: Props) {
  if (!node) {
    return (
      <Card className="p-3 self-start">
        <p className="text-xs text-fg-muted">
          Click any node to inspect it and load its blast radius.
        </p>
      </Card>
    )
  }
  const occ = nodeMetadataValue(node, 'occurrence_count')
  const reportLink =
    node.node_type === 'component'
      ? `/reports?component=${encodeURIComponent(node.label)}`
      : node.node_type === 'page'
        ? `/reports?url=${encodeURIComponent(node.label)}`
        : null

  return (
    <Card className="p-3 self-start space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-2xs uppercase tracking-wider text-fg-faint">
            {NODE_TYPE_LABELS[node.node_type] ?? node.node_type}
          </div>
          <h3 className="text-sm font-medium text-fg break-words">{node.label}</h3>
        </div>
        <button
          type="button"
          onClick={onClear}
          className="text-2xs text-fg-faint hover:text-fg-muted px-1.5 py-0.5"
          aria-label="Clear selection"
        >
          ✕
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 text-2xs">
        {occ != null && (
          <div>
            <div className="text-fg-faint">Occurrences</div>
            <div className="font-mono text-fg">{occ}</div>
          </div>
        )}
        {node.last_traversed_at && (
          <div>
            <div className="text-fg-faint">Last seen</div>
            <div className="text-fg-secondary">
              <RelativeTime value={node.last_traversed_at} />
            </div>
          </div>
        )}
        {node.created_at && (
          <div>
            <div className="text-fg-faint">First seen</div>
            <div className="text-fg-secondary">
              <RelativeTime value={node.created_at} />
            </div>
          </div>
        )}
        <div className="col-span-2">
          <div className="text-fg-faint">Node id</div>
          <div className="font-mono text-fg-secondary break-all">{node.id}</div>
        </div>
      </div>

      {reportLink && (
        <Link to={reportLink} className="inline-block text-xs text-brand hover:text-brand-hover">
          View related reports →
        </Link>
      )}

      <div className="border-t border-edge-subtle pt-2">
        <div className="flex items-center justify-between mb-1">
          <h4 className="text-xs font-medium text-fg-secondary">Blast radius</h4>
          {blastRadius.length > 0 && (
            <Badge className="bg-surface-overlay text-fg-muted text-3xs">{blastRadius.length}</Badge>
          )}
        </div>
        {blastLoading ? (
          <p className="text-2xs text-fg-faint">Computing…</p>
        ) : blastRadius.length === 0 ? (
          <p className="text-2xs text-fg-faint">
            Nothing downstream — this node doesn't propagate via causes/affects/related_to.
          </p>
        ) : (
          <ul className="text-2xs text-fg-muted space-y-0.5 max-h-56 overflow-y-auto">
            {blastRadius.map((b, i) => (
              <li key={i} className="flex items-center gap-1">
                <span
                  className="w-2 h-2 rounded-full inline-block shrink-0"
                  style={{ backgroundColor: NODE_COLORS[b.node_type] ?? 'oklch(0.45 0 0)' }}
                />
                <span className="truncate">{b.label}</span>
                <span className="text-fg-faint font-mono shrink-0">d{b.min_depth}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  )
}
