import { Link } from 'react-router-dom'
import {
  OPERATION_CATEGORY_CLASS,
  operationLinkTo,
  resolveOperation,
} from '../lib/llmOperations'
import { Tooltip } from './ui'

export function OperationChip({
  operation,
  maxWidthClass = 'max-w-[11rem]',
  className = '',
}: {
  operation: string
  maxWidthClass?: string
  className?: string
}) {
  const info = resolveOperation(operation)
  const tone = OPERATION_CATEGORY_CLASS[info.category]
  const to = operationLinkTo(info)

  return (
    <Tooltip
      nowrap={false}
      content={
        <div className="max-w-[16rem] space-y-1 text-left">
          <p className="text-xs font-medium text-fg">{info.label}</p>
          <p className="text-2xs text-fg-muted leading-snug">{info.description}</p>
          <p className="text-2xs text-brand">Open {info.label} →</p>
        </div>
      }
    >
      <Link
        to={to}
        className={`inline-flex max-w-full items-center rounded-sm border px-1.5 py-0.5 font-mono text-2xs leading-snug transition-colors ${tone} ${maxWidthClass} ${className}`}
        title={info.description}
      >
        <span className="truncate">{operation}</span>
      </Link>
    </Tooltip>
  )
}
