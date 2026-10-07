/**
 * FILE: apps/admin/src/components/content-quality/ContentBulkDismiss.tsx
 * PURPOSE: Bulk dismiss for the Content checks list. A person dismisses the
 *          rows they ticked, or every row matching the current filter, after
 *          an in-page confirmation that states the exact number of rows (a
 *          server dry run, not the list total) and a required reason.
 *
 *          The server refuses with COUNT_CHANGED when the live count differs
 *          from the confirmed one; the dialog then recounts and asks again.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../../lib/supabase'
import { apiErrorText } from '../../lib/apiErrorText'
import { ConfirmDialog } from '../ConfirmDialog'
import { Btn, Textarea } from '../ui'

/** The list filter, in the shape the dismiss route takes. */
export interface ContentDismissFilter {
  status: 'open' | 'in_review'
  reason?: string
  content_type?: string
  /** `null` = rows with no source. */
  source?: string | null
  score_band?: string
}

type DismissScope = { kind: 'ids'; ids: string[] } | { kind: 'filter'; filter: ContentDismissFilter }

interface DismissCount {
  matched: number
  will_dismiss: number
  max_rows: number
}

interface DismissResult {
  dismissed: number
  remaining: number
}

const fmt = (n: number) => n.toLocaleString()

function countSentence(count: DismissCount): string {
  if (count.will_dismiss === 0) return 'No rows match any more, so nothing will be dismissed.'
  if (count.will_dismiss < count.matched) {
    return `This dismisses ${fmt(count.will_dismiss)} of ${fmt(count.matched)} matching rows (one run dismisses at most ${fmt(count.max_rows)}). Run it again for the rest.`
  }
  return `This dismisses exactly ${fmt(count.will_dismiss)} row${count.will_dismiss === 1 ? '' : 's'}.`
}

interface DialogProps {
  projectId: string
  scope: DismissScope
  onDone: (result: DismissResult) => void
  onCancel: () => void
}

function BulkDismissDialog({ projectId, scope, onDone, onCancel }: DialogProps) {
  const path = `/v1/admin/projects/${projectId}/content-quality/dismiss`
  const scopeJson = useMemo(
    () => JSON.stringify(scope.kind === 'ids' ? { ids: scope.ids } : { filter: scope.filter }),
    [scope],
  )
  const [count, setCount] = useState<DismissCount | null>(null)
  const [countError, setCountError] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [noteError, setNoteError] = useState<string | undefined>(undefined)
  const [notice, setNotice] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const countRows = useCallback(async () => {
    setCount(null)
    setCountError(null)
    try {
      const res = await apiFetch<DismissCount>(path, {
        method: 'POST',
        body: JSON.stringify({ ...JSON.parse(scopeJson), dry_run: true }),
        cache: 'no-store',
      })
      if (res.ok && res.data) setCount(res.data)
      else setCountError(apiErrorText(res.error, 'The rows could not be counted. Close and try again.'))
    } catch {
      setCountError('The rows could not be counted. Check your connection and try again.')
    }
  }, [path, scopeJson])

  useEffect(() => {
    void countRows()
  }, [countRows])

  async function confirm() {
    if (!count || count.will_dismiss === 0) return
    const reason = note.trim()
    if (reason.length < 3) {
      setNoteError('Say why these rows are noise (at least 3 characters).')
      return
    }
    setSaving(true)
    setNotice(null)
    try {
      const res = await apiFetch<DismissResult>(path, {
        method: 'POST',
        body: JSON.stringify({ ...JSON.parse(scopeJson), reason, expected_count: count.will_dismiss }),
        cache: 'no-store',
      })
      if (res.ok && res.data) {
        onDone(res.data)
        return
      }
      if (res.error?.code === 'COUNT_CHANGED') {
        setNotice('The number of matching rows changed. Check the new number and confirm again.')
        void countRows()
        return
      }
      setNotice(apiErrorText(res.error, 'Nothing was dismissed. Try again.'))
    } catch {
      setNotice('Nothing was dismissed. Check your connection and try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <ConfirmDialog
      title="Dismiss content checks"
      body="Dismissed rows leave the Open list. The source sending the same item again does not reopen them; new flags, new downvotes or a clearly lower score do. You can reopen any row from its page."
      details={
        <p className="font-medium text-fg" aria-live="polite">
          {count ? countSentence(count) : (countError ?? 'Counting the matching rows…')}
        </p>
      }
      confirmLabel={count && count.will_dismiss > 0 ? `Dismiss ${fmt(count.will_dismiss)}` : 'Dismiss'}
      cancelLabel="Keep them"
      tone="danger"
      loading={saving}
      confirmDisabled={!count || count.will_dismiss === 0}
      onConfirm={confirm}
      onCancel={() => {
        if (!saving) onCancel()
      }}
    >
      <Textarea
        label="Reason (required)"
        placeholder="e.g. test rows from the bridge setup"
        value={note}
        maxLength={500}
        rows={2}
        error={noteError}
        disabled={saving}
        onChange={(e) => {
          setNote(e.target.value)
          if (noteError) setNoteError(undefined)
        }}
      />
      {notice && (
        <p role="alert" className="text-2xs text-danger leading-snug">
          {notice}
        </p>
      )}
    </ConfirmDialog>
  )
}

interface BarProps {
  projectId: string
  selectedIds: string[]
  /** Rows the current filter matches (the list total). */
  matchingTotal: number
  filter: ContentDismissFilter
  onDismissed: (result: DismissResult) => void
}

/** "N selected · Dismiss selected · Dismiss all matching" above the list. */
export function ContentBulkDismissBar({ projectId, selectedIds, matchingTotal, filter, onDismissed }: BarProps) {
  const [scope, setScope] = useState<DismissScope | null>(null)

  return (
    <div className="mb-2 flex flex-wrap items-center gap-2 text-2xs text-fg-muted">
      <span>{fmt(selectedIds.length)} selected</span>
      <Btn
        size="sm"
        variant="ghost"
        disabled={selectedIds.length === 0}
        onClick={() => setScope({ kind: 'ids', ids: selectedIds })}
      >
        Dismiss selected
      </Btn>
      <Btn
        size="sm"
        variant="ghost"
        disabled={matchingTotal === 0}
        onClick={() => setScope({ kind: 'filter', filter })}
        title="Dismiss every row the current filters match, not only this page."
      >
        Dismiss all {fmt(matchingTotal)} matching
      </Btn>
      {scope && (
        <BulkDismissDialog
          projectId={projectId}
          scope={scope}
          onDone={(result) => {
            setScope(null)
            onDismissed(result)
          }}
          onCancel={() => setScope(null)}
        />
      )}
    </div>
  )
}
