/**
 * FILE: apps/admin/src/components/skill-pipeline/SkillStepNode.tsx
 * PURPOSE: Custom React Flow node for a single skill pipeline step.
 *          Shows the skill slug, status badge, and a PR link when available.
 *          Reuses the visual language of PdcaStepNode (status ring, glow)
 *          without coupling to PDCA's fixed 4-stage data model.
 */

import { memo } from 'react'
import { Handle, Position } from '@xyflow/react'
import type { NodeProps } from '@xyflow/react'
import type { PipelineStepNodeData } from './pipelineFlow.data'
import { STEP_STATUS_HEX, STEP_STATUS_LABEL } from './pipelineFlow.data'

function SkillStepNodeInner({ data }: NodeProps) {
  const node = data as PipelineStepNodeData
  const statusColor = STEP_STATUS_HEX[node.status] ?? '#94a3b8'
  const statusLabel = STEP_STATUS_LABEL[node.status] ?? node.status

  return (
    <div
      className="relative flex flex-col gap-1.5 p-3 rounded-xl border border-border bg-surface-raised transition-shadow"
      style={{
        boxShadow: node.isCurrent
          ? `0 0 0 2px ${statusColor}, 0 0 16px 4px ${statusColor}33`
          : undefined,
      }}
    >
      {/* Handles for edges */}
      <Handle type="target" position={Position.Left} id="in" style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Right} id="out" style={{ opacity: 0 }} />

      {/* Step index badge */}
      <div className="flex items-center gap-2">
        <span
          className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-2xs font-bold text-surface"
          style={{ background: statusColor }}
        >
          {node.stepIndex + 1}
        </span>
        {/* Status dot */}
        <span
          className="flex-shrink-0 w-2 h-2 rounded-full"
          style={{ background: statusColor }}
          title={statusLabel}
        />
        <span className="text-2xs text-fg-muted font-medium">{statusLabel}</span>
      </div>

      {/* Skill title */}
      <p className="text-xs font-semibold text-fg leading-snug line-clamp-2">
        {node.skillTitle}
      </p>

      {/* Slug */}
      <p className="text-2xs text-fg-muted font-mono truncate">{node.skillSlug}</p>

      {/* PR link */}
      {node.prUrl && (
        <a
          href={node.prUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-2xs text-brand hover:underline truncate"
          onClick={(e) => e.stopPropagation()}
        >
          View PR →
        </a>
      )}

      {/* Notes */}
      {node.notes && (
        <p className="text-2xs text-fg-muted italic line-clamp-2">{node.notes}</p>
      )}
    </div>
  )
}

export const SkillStepNode = memo(SkillStepNodeInner)
