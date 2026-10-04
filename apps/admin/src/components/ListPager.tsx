/**
 * FILE: apps/admin/src/components/ListPager.tsx
 * PURPOSE: "Showing 51–73 of 73 runs" plus Previous / Next, for lists whose
 *          server caps a page (console QA group C: /iterate runs, /fixes
 *          attempts and /judge evaluations each showed only the first 50
 *          while a badge counted them all).
 */

import { Btn } from './ui'

function pageRange(page: number, pageSize: number, total: number): { from: number; to: number; pages: number } {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const current = Math.min(Math.max(1, page), pages)
  if (total === 0) return { from: 0, to: 0, pages }
  return { from: (current - 1) * pageSize + 1, to: Math.min(current * pageSize, total), pages }
}

interface Props {
  page: number
  pageSize: number
  total: number
  /** Plural noun for the rows, e.g. "runs". */
  noun: string
  onPage: (page: number) => void
  busy?: boolean
}

export function ListPager({ page, pageSize, total, noun, onPage, busy = false }: Props) {
  const { from, to, pages } = pageRange(page, pageSize, total)
  if (total <= pageSize && page <= 1) return null
  return (
    <nav
      aria-label={`${noun} pages`}
      className="flex flex-wrap items-center justify-between gap-2 px-1 py-2 text-2xs text-fg-muted"
    >
      <span className="tabular-nums" aria-live="polite">
        Showing {from}–{to} of {total} {noun}
      </span>
      <span className="flex items-center gap-1.5">
        <Btn size="sm" variant="ghost" onClick={() => onPage(page - 1)} disabled={busy || page <= 1}>
          ← Previous
        </Btn>
        <span className="tabular-nums">
          Page {Math.min(page, pages)} of {pages}
        </span>
        <Btn size="sm" variant="ghost" onClick={() => onPage(page + 1)} disabled={busy || page >= pages}>
          Next →
        </Btn>
      </span>
    </nav>
  )
}
