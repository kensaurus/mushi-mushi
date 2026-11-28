import { Link } from 'react-router-dom'
import { Tooltip } from '../ui'
import { CHIP_TONE } from '../../lib/chipTone'

export function ModelChip({
  model,
  maxWidthClass = 'max-w-40',
}: {
  model: string
  maxWidthClass?: string
}) {
  return (
    <Tooltip
      nowrap={false}
      content={
        <div className="max-w-56 space-y-1 text-left">
          <p className="text-xs font-medium text-fg">{model}</p>
          <p className="text-2xs text-fg-muted">
            Provider model used for this call. Compare usage on Health and Cost.
          </p>
          <p className="text-2xs text-brand">Open Health →</p>
        </div>
      }
    >
      <Link
        to="/health"
        className={`inline-block truncate rounded-sm ${CHIP_TONE.neutral} px-1.5 py-px font-mono text-2xs leading-snug hover:text-brand transition-opacity ${maxWidthClass}`}
      >
        {model}
      </Link>
    </Tooltip>
  )
}

export function TokenIn({ value }: { value: number }) {
  return (
    <span className="tabular-nums text-2xs text-ok" title="Input tokens">
      {value.toLocaleString()}
    </span>
  )
}

export function TokenOut({ value }: { value: number }) {
  return (
    <span className="tabular-nums text-2xs text-rose" title="Output tokens">
      {value.toLocaleString()}
    </span>
  )
}

export function UsdAmount({ value, digits = 4 }: { value: number; digits?: number }) {
  return (
    <span className="tabular-nums text-2xs font-medium text-fg">
      ${Number(value).toFixed(digits)}
    </span>
  )
}
