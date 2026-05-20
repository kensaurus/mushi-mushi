import { Link } from 'react-router-dom'
import { auditResourcePath, resolveAuditResource } from '../lib/auditResources'
import { Tooltip } from './ui'

export function AuditResourceChip({
  resourceType,
  resourceId,
}: {
  resourceType: string
  resourceId: string | null
}) {
  const info = resolveAuditResource(resourceType)
  const to = auditResourcePath(resourceType, resourceId)
  const label = resourceId ? `${resourceType}:${resourceId.slice(0, 8)}` : resourceType

  return (
    <Tooltip
      nowrap={false}
      content={
        <div className="max-w-[14rem] space-y-1 text-left">
          <p className="text-xs font-medium text-fg">{info.label}</p>
          <p className="text-2xs text-fg-muted leading-snug">{info.description}</p>
        </div>
      }
    >
      <Link
        to={to}
        className={`inline-flex max-w-[10rem] items-center truncate rounded-sm border px-1.5 py-0.5 font-mono text-2xs transition-colors ${info.className}`}
      >
        {label}
      </Link>
    </Tooltip>
  )
}
