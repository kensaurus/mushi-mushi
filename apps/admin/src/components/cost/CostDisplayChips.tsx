import { Link } from 'react-router-dom'
import { Tooltip } from '../ui'

export function ModelChip({
  model,
  maxWidthClass = 'max-w-[10rem]',
}: {
  model: string
  maxWidthClass?: string
}) {
  return (
    <Tooltip
      nowrap={false}
      content={
        <div className="max-w-[14rem] space-y-1 text-left">
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
        className={`inline-block truncate rounded-sm border border-edge-subtle bg-surface-overlay/70 px-1.5 py-0.5 font-mono text-2xs leading-snug text-fg-secondary hover:border-brand/30 hover:text-brand transition-colors ${maxWidthClass}`}
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
