import { useMemo } from 'react'
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table'
import { Badge } from '../ui'
import { InventoryStatusPill } from './InventoryStatusPill'

export interface TreeRow {
  id: string
  pageId: string
  pagePath: string
  elementId: string
  actionLabel: string
  status: string
  /** Pretty-printed list — kept for backwards compat. */
  backend?: string
  verifiedBy?: string
  /** Structured copies the row uses to render proper chips. */
  backendList?: Array<{ method: string; path: string }>
  testList?: Array<{ file: string; name: string; framework?: string }>
}

const col = createColumnHelper<TreeRow>()

interface Props {
  rows: TreeRow[]
  onRowClick?: (row: TreeRow) => void
}

function frameworkChip(framework: string | undefined): string {
  switch (framework) {
    case 'playwright':
      return 'bg-ok-muted text-ok border border-ok/25'
    case 'vitest':
      return 'bg-warn-muted text-warn border border-warn/25'
    case 'cypress':
      return 'bg-info-muted text-info border border-info/25'
    case 'jest':
      return 'bg-danger-muted text-danger border border-danger/25'
    default:
      return 'bg-surface-overlay text-fg-muted border border-edge-subtle'
  }
}

export function InventoryTree({ rows, onRowClick }: Props) {
  const columns = useMemo(
    () => [
      col.accessor('pagePath', {
        header: 'Page',
        cell: (c) => <span className="font-mono text-2xs">{c.getValue()}</span>,
      }),
      col.accessor('elementId', {
        header: 'Element',
        cell: (c) => <code className="text-2xs">{c.getValue()}</code>,
      }),
      col.accessor('actionLabel', {
        header: 'Action',
        cell: (c) => (
          <span className="text-xs leading-tight max-w-[24rem] block truncate" title={c.getValue() as string}>
            {c.getValue()}
          </span>
        ),
      }),
      col.accessor('status', {
        header: 'Status',
        cell: (c) => <InventoryStatusPill status={c.getValue()} />,
      }),
      col.display({
        id: 'backend',
        header: 'Backend',
        cell: (c) => {
          const list = c.row.original.backendList ?? []
          if (!list.length) return <span className="text-2xs text-fg-faint">—</span>
          return (
            <div className="flex flex-wrap gap-1 max-w-[16rem]">
              {list.slice(0, 3).map((b, i) => (
                <Badge
                  key={i}
                  className="bg-surface-overlay/60 text-fg-muted border border-edge-subtle font-mono"
                  title={`${b.method} ${b.path}`}
                >
                  {b.method} {b.path.length > 18 ? `${b.path.slice(0, 18)}…` : b.path}
                </Badge>
              ))}
              {list.length > 3 && (
                <span className="text-2xs text-fg-faint">+{list.length - 3}</span>
              )}
            </div>
          )
        },
      }),
      col.display({
        id: 'tests',
        header: 'Tests',
        cell: (c) => {
          const list = c.row.original.testList ?? []
          if (!list.length) {
            return (
              <Badge
                className="bg-danger-muted text-danger border border-danger/25 font-mono"
                title="No verified_by entry — this action has no automated coverage declared in inventory.yaml"
              >
                untested
              </Badge>
            )
          }
          return (
            <div className="flex flex-wrap gap-1 max-w-[18rem]">
              {list.slice(0, 2).map((t, i) => (
                <Badge
                  key={i}
                  className={`${frameworkChip(t.framework)} font-mono`}
                  title={`${t.file} :: ${t.name}${t.framework ? ` (${t.framework})` : ''}`}
                >
                  {t.framework ?? 'test'}: {t.name.length > 22 ? `${t.name.slice(0, 22)}…` : t.name}
                </Badge>
              ))}
              {list.length > 2 && (
                <span className="text-2xs text-fg-faint">+{list.length - 2}</span>
              )}
            </div>
          )
        },
      }),
    ],
    [],
  )

  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
  })

  if (!rows.length) {
    return <p className="text-xs text-fg-muted py-6 text-center">No inventory rows — ingest yaml first.</p>
  }

  return (
    <div className="overflow-auto rounded-md border border-edge-subtle">
      <table className="w-full text-left text-2xs">
        <thead className="bg-surface-overlay/50 text-fg-muted uppercase tracking-wider">
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((h) => (
                <th key={h.id} className="px-2 py-2 font-medium">
                  {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr
              key={row.id}
              onClick={() => onRowClick?.(row.original)}
              className="border-t border-edge-subtle hover:bg-surface-overlay/40 cursor-pointer"
            >
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id} className="px-2 py-1.5 align-middle">
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
