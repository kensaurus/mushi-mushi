/**
 * FILE: apps/admin/src/components/marketplace/DispatchTable.tsx
 * PURPOSE: Filterable table of recent webhook deliveries. Each row expands to
 *          show the full response excerpt for fast debugging of plugin
 *          receivers without leaving the page.
 */

import { Fragment, useState } from 'react'
import { EmptyState, FilterSelect } from '../ui'
import { STATUS_CHIP, STATUS_FILTER_OPTIONS, type DispatchEntry } from './types'

interface Props {
  entries: DispatchEntry[]
  installedPluginOptions: string[]
  pluginFilter: string
  statusFilter: string
  onPluginFilter: (v: string) => void
  onStatusFilter: (v: string) => void
}

export function DispatchTable({
  entries,
  installedPluginOptions,
  pluginFilter,
  statusFilter,
  onPluginFilter,
  onStatusFilter,
}: Props) {
  const [expandedDelivery, setExpandedDelivery] = useState<number | null>(null)

  return (
    <>
      <div className="flex flex-wrap gap-2 mb-2">
        <FilterSelect
          label="Plugin"
          value={pluginFilter}
          options={installedPluginOptions}
          onChange={(e) => onPluginFilter(e.currentTarget.value)}
        />
        <FilterSelect
          label="Status"
          value={statusFilter}
          options={STATUS_FILTER_OPTIONS}
          onChange={(e) => onStatusFilter(e.currentTarget.value)}
        />
      </div>
      {entries.length === 0 ? (
        <EmptyState
          title="No deliveries match these filters"
          description="Try clearing plugin or status filters."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-2xs">
            <thead className="text-left opacity-60">
              <tr>
                <th className="px-2 py-1.5">When</th>
                <th className="px-2 py-1.5">Plugin</th>
                <th className="px-2 py-1.5">Event</th>
                <th className="px-2 py-1.5">Status</th>
                <th className="px-2 py-1.5">HTTP</th>
                <th className="px-2 py-1.5">Duration</th>
                <th className="px-2 py-1.5">Response</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((d) => {
                const isExpanded = expandedDelivery === d.id
                const hasResponse = d.response_excerpt && d.response_excerpt.length > 0
                return (
                  <Fragment key={d.id}>
                    <tr
                      className="border-t border-border-subtle hover:bg-surface-overlay/30 cursor-pointer"
                      onClick={() =>
                        hasResponse && setExpandedDelivery(isExpanded ? null : d.id)
                      }
                    >
                      <td className="px-2 py-1.5">{new Date(d.created_at).toLocaleString()}</td>
                      <td className="px-2 py-1.5">
                        <code className="bg-surface-raised px-1 py-0.5 rounded">{d.plugin_slug}</code>
                      </td>
                      <td className="px-2 py-1.5">
                        <code className="bg-surface-raised px-1 py-0.5 rounded">{d.event}</code>
                      </td>
                      <td className="px-2 py-1.5">
                        <span className={`inline-flex rounded px-1.5 py-0.5 ${STATUS_CHIP[d.status]}`}>
                          {d.status}
                        </span>
                      </td>
                      <td className="px-2 py-1.5">{d.http_status ?? '—'}</td>
                      <td className="px-2 py-1.5">
                        {d.duration_ms != null ? `${d.duration_ms}ms` : '—'}
                      </td>
                      <td className="px-2 py-1.5 max-w-[28ch] truncate">
                        {hasResponse
                          ? isExpanded
                            ? '▾ collapse'
                            : `▸ ${d.response_excerpt?.slice(0, 32)}…`
                          : '—'}
                      </td>
                    </tr>
                    {isExpanded && hasResponse && (
                      <tr className="bg-surface-overlay/30 border-t border-border-subtle">
                        <td colSpan={7} className="px-3 py-2">
                          <div className="text-3xs text-fg-muted uppercase tracking-wider mb-1">
                            Full response · delivery {d.delivery_id.slice(0, 8)}…
                          </div>
                          <pre className="text-3xs font-mono text-fg-secondary overflow-x-auto whitespace-pre-wrap break-all bg-surface-raised rounded-sm p-2">
                            {d.response_excerpt}
                          </pre>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
