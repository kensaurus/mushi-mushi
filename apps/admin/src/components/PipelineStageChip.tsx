import { Link } from 'react-router-dom'
import { resolvePipelineStage } from '../lib/pipelineStages'
import { Tooltip } from './ui'

export function PipelineStageChip({
  stage,
  maxWidthClass = 'max-w-[9rem]',
}: {
  stage: string
  maxWidthClass?: string
}) {
  const info = resolvePipelineStage(stage)

  return (
    <Tooltip
      nowrap={false}
      content={
        <div className="max-w-[14rem] space-y-1 text-left">
          <p className="text-xs font-medium text-fg">{info.label}</p>
          <p className="text-2xs text-fg-muted leading-snug">{info.description}</p>
          <p className="text-2xs text-brand">Open {info.label} →</p>
        </div>
      }
    >
      <Link
        to={info.to}
        className={`inline-flex max-w-full items-center rounded-sm border px-1.5 py-0.5 font-mono text-2xs leading-snug transition-colors truncate ${info.className} ${maxWidthClass}`}
        title={info.description}
      >
        {stage}
      </Link>
    </Tooltip>
  )
}
