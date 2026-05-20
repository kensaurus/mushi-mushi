/**
 * Raw LLM cost log — Claude Console–style toolbar: search, page size,
 * sortable columns, and paginated range indicator.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { ColumnDef, OnChangeFn, SortingState } from '@tanstack/react-table'
import { usePageData } from '../../lib/usePageData'
import {
  Btn,
  EmptyState,
  ErrorAlert,
  Input,
  RelativeTime,
  SelectField,
} from '../ui'
import { OperationChip } from '../OperationChip'
import { ModelChip, TokenIn, TokenOut, UsdAmount } from './CostDisplayChips'
import { DataTable } from '../DataTable'
import { TableSkeleton } from '../skeletons/TableSkeleton'

export interface CostRow {
  id: string
  project_id: string
  operation: string
  model: string
  input_tokens: number
  output_tokens: number
  cost_usd: number
  occurred_at: string
  source?: 'invocation' | 'ledger'
}

interface CostListPayload {
  rows: CostRow[]
  total: number
  page: number
  limit: number
  sort: string
  order: string
  capped?: boolean
}

const PAGE_SIZES = [25, 50, 100, 200] as const

const SORT_ID_TO_PARAM: Record<string, string> = {
  operation: 'operation',
  model: 'model',
  input_tokens: 'input_tokens',
  output_tokens: 'output_tokens',
  cost_usd: 'cost_usd',
  occurred_at: 'occurred_at',
}

export function CostRawLogTable({ projectId }: { projectId: string }) {
  const [searchParams, setSearchParams] = useSearchParams()

  const page = Math.max(1, parseInt(searchParams.get('log_page') ?? '1', 10) || 1)
  const limitParam = Number(searchParams.get('log_limit'))
  const limit = (PAGE_SIZES as readonly number[]).includes(limitParam) ? limitParam : 25
  const q = searchParams.get('log_q') ?? ''
  const sort = searchParams.get('log_sort') ?? 'occurred_at'
  const order = searchParams.get('log_order') === 'asc' ? 'asc' : 'desc'

  const [searchDraft, setSearchDraft] = useState(q)

  useEffect(() => {
    setSearchDraft(q)
  }, [q])

  const updateParams = useCallback(
    (patch: Record<string, string | null>) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev)
        for (const [key, value] of Object.entries(patch)) {
          if (value == null || value === '') next.delete(key)
          else next.set(key, value)
        }
        return next
      }, { replace: true })
    },
    [setSearchParams],
  )

  useEffect(() => {
    const id = setTimeout(() => {
      if (searchDraft === q) return
      updateParams({ log_q: searchDraft || null, log_page: '1' })
    }, 350)
    return () => clearTimeout(id)
  }, [searchDraft, q, updateParams])

  const queryString = useMemo(() => {
    const p = new URLSearchParams()
    p.set('project_id', projectId)
    p.set('page', String(page))
    p.set('limit', String(limit))
    p.set('sort', sort)
    p.set('order', order)
    if (q) p.set('q', q)
    return p.toString()
  }, [projectId, page, limit, sort, order, q])

  const { data, loading, error } = usePageData<CostListPayload>(
    `/v1/admin/costs?${queryString}`,
    { deps: [queryString] },
  )

  const rows = data?.rows ?? []
  const total = data?.total ?? 0
  const capped = data?.capped ?? false
  const totalPages = Math.max(1, Math.ceil(total / limit))
  const rangeStart = total === 0 ? 0 : (page - 1) * limit + 1
  const rangeEnd = Math.min(page * limit, total)

  const sorting: SortingState = useMemo(
    () => [{ id: sort, desc: order === 'desc' }],
    [sort, order],
  )

  const columns = useMemo<ColumnDef<CostRow, unknown>[]>(
    () => [
      {
        id: 'operation',
        header: 'Operation',
        accessorKey: 'operation',
        enableSorting: true,
        cell: ({ row }) => (
          <OperationChip operation={row.original.operation} maxWidthClass="max-w-[10rem]" />
        ),
      },
      {
        id: 'model',
        header: 'Model',
        accessorKey: 'model',
        enableSorting: true,
        cell: ({ row }) => (
          <ModelChip model={row.original.model} maxWidthClass="max-w-[10rem]" />
        ),
      },
      {
        id: 'input_tokens',
        header: 'In',
        accessorKey: 'input_tokens',
        enableSorting: true,
        cell: ({ row }) => (
          <div className="text-right">
            <TokenIn value={row.original.input_tokens} />
          </div>
        ),
      },
      {
        id: 'output_tokens',
        header: 'Out',
        accessorKey: 'output_tokens',
        enableSorting: true,
        cell: ({ row }) => (
          <div className="text-right">
            <TokenOut value={row.original.output_tokens} />
          </div>
        ),
      },
      {
        id: 'cost_usd',
        header: 'Cost',
        accessorKey: 'cost_usd',
        enableSorting: true,
        cell: ({ row }) => (
          <div className="text-right">
            <UsdAmount value={row.original.cost_usd} digits={5} />
          </div>
        ),
      },
      {
        id: 'occurred_at',
        header: 'When',
        accessorKey: 'occurred_at',
        enableSorting: true,
        cell: ({ row }) => (
          <span className="text-fg-muted whitespace-nowrap">
            <RelativeTime value={row.original.occurred_at} />
          </span>
        ),
      },
    ],
    [],
  )

  const onSortingChange: OnChangeFn<SortingState> = useCallback(
    (updater) => {
      const next = typeof updater === 'function' ? updater(sorting) : updater
      const first = next[0]
      if (!first) return
      const param = SORT_ID_TO_PARAM[first.id] ?? 'occurred_at'
      updateParams({
        log_sort: param,
        log_order: first.desc ? 'desc' : 'asc',
        log_page: '1',
      })
    },
    [sorting, updateParams],
  )

  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-xs font-medium text-fg-muted uppercase tracking-wide">Raw log</p>
          <p className="text-2xs text-fg-faint">
            {total === 0
              ? 'No calls match your filters'
              : `Showing ${rangeStart}–${rangeEnd} of ${total.toLocaleString()}${capped ? '+' : ''}`}
            {q ? ` · filtered by “${q}”` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2 sm:justify-end">
          <div className="min-w-[12rem] flex-1 sm:flex-none sm:w-56">
            <Input
              label="Search"
              placeholder="Operation, model, id…"
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  updateParams({ log_q: searchDraft || null, log_page: '1' })
                }
              }}
            />
          </div>
          <SelectField
            label="Rows"
            value={String(limit)}
            onChange={(e) =>
              updateParams({ log_limit: e.target.value, log_page: '1' })
            }
            className="w-24"
          >
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </SelectField>
        </div>
      </div>

      {loading ? (
        <TableSkeleton rows={10} />
      ) : error ? (
        <ErrorAlert message={error} />
      ) : rows.length === 0 ? (
        <EmptyState
          title={q ? 'No matching calls' : 'No cost records'}
          description={
            q
              ? 'Try a different search term or clear filters.'
              : 'LLM calls will appear here once edge functions run.'
          }
        />
      ) : (
        <>
          <DataTable
            data={rows}
            columns={columns}
            getRowId={(r) => r.id}
            sorting={sorting}
            onSortingChange={onSortingChange}
            density="compact"
            ariaLabel="LLM cost raw log"
            className="overflow-visible border-edge-subtle"
          />
          {capped && (
            <p className="text-3xs text-fg-faint px-1">
              Results capped at 5,000 merged rows — narrow with search or export from summary for full history.
            </p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <span className="text-2xs text-fg-muted tabular-nums">
              Page {page} of {totalPages}
            </span>
            <div className="flex items-center gap-1">
              <Btn
                size="sm"
                variant="ghost"
                disabled={page <= 1}
                onClick={() => updateParams({ log_page: String(page - 1) })}
              >
                Previous
              </Btn>
              <Btn
                size="sm"
                variant="ghost"
                disabled={page >= totalPages}
                onClick={() => updateParams({ log_page: String(page + 1) })}
              >
                Next
              </Btn>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
