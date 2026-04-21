/**
 * FILE: apps/admin/src/components/fixes/FixStageNode.tsx
 * PURPOSE: Compact React Flow node used inside the FixAttemptFlow — a
 *          per-fix row rendering Report → Dispatch → PR → Judge → Ship
 *          with live status (pending / active / done / failed). Smaller
 *          than PdcaStepNode because a single card can host many of these.
 */

import { memo } from 'react'
import { Handle, Position } from '@xyflow/react'
import type { NodeProps } from '@xyflow/react'
import { Link } from 'react-router-dom'
import type { FixStageNodeData } from './fixAttemptFlow.data'
import { STAGE_HEX } from '../flow-primitives/flowTokens'

const STATUS_CLS: Record<FixStageNodeData['status'], string> = {
  pending: 'border-edge-subtle bg-surface-raised/50 text-fg-faint',
  active: 'border-brand/60 bg-brand/10 text-fg mushi-running-glow',
  done: 'border-ok/40 bg-ok-muted/20 text-fg',
  failed: 'border-danger/50 bg-danger-muted/20 text-danger',
  skipped: 'border-edge-subtle bg-surface-raised/30 text-fg-faint',
}

const STATUS_GLYPH: Record<FixStageNodeData['status'], string> = {
  pending: '○',
  active: '↻',
  done: '✓',
  failed: '✕',
  skipped: '–',
}

function FixStageNodeInner({ data }: NodeProps) {
  const node = data as FixStageNodeData
  const cls = STATUS_CLS[node.status]
  const glyph = STATUS_GLYPH[node.status]
  const stageColor = STAGE_HEX[node.pdcaStage]

  const content = (
    <div className={`w-36 rounded-md border px-2 py-1.5 text-[11px] shadow-sm motion-safe:transition-colors pointer-events-auto ${cls}`}>
      <Handle type="target" position={Position.Left} id="in" className="!bg-transparent !border-none !w-1 !h-1" />
      <Handle type="source" position={Position.Right} id="out" className="!bg-transparent !border-none !w-1 !h-1" />
      <div className="flex items-center gap-1.5">
        <span
          aria-hidden="true"
          className="inline-flex h-4 w-4 items-center justify-center rounded-sm font-bold text-[9px] leading-none shrink-0"
          style={{ backgroundColor: stageColor + '33', color: stageColor }}
        >
          {node.letter}
        </span>
        <span className="font-medium flex-1 truncate">{node.label}</span>
        <span
          aria-hidden="true"
          className={`text-[10px] font-mono leading-none ${node.status === 'active' ? 'motion-safe:animate-spin' : ''}`}
        >
          {glyph}
        </span>
      </div>
      {node.sublabel && (
        <div className="mt-0.5 text-[10px] font-mono text-fg-faint truncate">{node.sublabel}</div>
      )}
    </div>
  )

  if (!node.href) return content
  if (node.external) {
    return (
      <a
        href={node.href}
        target="_blank"
        rel="noopener noreferrer"
        className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 rounded-md"
      >
        {content}
      </a>
    )
  }
  return (
    <Link
      to={node.href}
      className="nodrag block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 rounded-md"
    >
      {content}
    </Link>
  )
}

export const FixStageNode = memo(FixStageNodeInner)
