import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import { debugWarn } from './debug'

/**
 * Reporter feedback chip — a structured 1-click signal the SDK widget can
 * attach to a comment. Mirrors the CHECK constraint on
 * `report_comments.feedback_signal` (migration 20260510020000).
 *
 *   confirms                — yes, this IS the bug I meant
 *   wrong_target            — agent fixed something that wasn't the bug
 *   agent_fixed_wrong_thing — partial: bug is right, fix is wrong
 *   already_fixed           — false positive, bug is gone
 *   noise                   — spam / off-topic / shouldn't have been classified
 */
export type FeedbackSignal =
  | 'confirms'
  | 'wrong_target'
  | 'agent_fixed_wrong_thing'
  | 'already_fixed'
  | 'noise'
  | 'not_fixed'

export interface ReportCommentRow {
  id: number
  report_id: string
  project_id: string
  author_user_id: string | null
  author_kind?: 'admin' | 'reporter'
  reporter_token_hash?: string | null
  author_name: string | null
  body: string
  visible_to_reporter: boolean
  parent_id: number | null
  edited_at: string | null
  created_at: string
  feedback_signal?: FeedbackSignal | null
}

export interface UseReportCommentsOptions {
  reportId: string | undefined
  projectId: string | undefined
}

export interface ReportCommentsThread {
  comments: ReportCommentRow[]
  loading: boolean
  /** Signed-in user's id; only their own comments can be deleted (RLS
   *  authors_delete_own_report_comments). Null until known. */
  currentUserId: string | null
  postComment: (body: string, options?: { visibleToReporter?: boolean; parentId?: number }) => Promise<void>
  deleteComment: (id: number) => Promise<void>
}

/**
 * Plain-English text for a failed comment write. Raw Postgres text ("new row
 * violates row-level security policy for table …") used to reach the toast.
 */
export function commentWriteErrorText(error: { message?: string; code?: string }, action: 'post' | 'delete'): string {
  const msg = (error.message ?? '').toLowerCase()
  if (error.code === '42501' || msg.includes('row-level security') || msg.includes('permission denied')) {
    return action === 'post'
      ? 'You do not have permission to comment on this project. Ask an owner or admin to give you member access.'
      : 'You can only delete comments you wrote.'
  }
  if (msg.includes('jwt') || msg.includes('not signed in') || msg.includes('session')) {
    return 'Your session expired. Sign in again, then retry.'
  }
  return action === 'post' ? 'The comment was not saved. Try again in a moment.' : 'The comment was not deleted. Try again in a moment.'
}

/**
 * One report's comment thread: an initial fetch plus a realtime channel that
 * refetches on change. Mount it ONCE per page and pass the result down — each
 * call opens its own fetch and channel (REPORT C, 2026-10-04: two consumers on
 * the report page made report_comments load 2x, 4x under StrictMode).
 */
export function useReportComments(opts: UseReportCommentsOptions): ReportCommentsThread {
  const { reportId, projectId } = opts
  const [comments, setComments] = useState<ReportCommentRow[]>([])
  const [loading, setLoading] = useState(false)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void supabase.auth.getUser().then(({ data }) => {
      if (!cancelled) setCurrentUserId(data.user?.id ?? null)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const refresh = useCallback(async () => {
    if (!reportId) return
    setLoading(true)
    const { data, error } = await supabase
      .from('report_comments')
      .select('*')
      .eq('report_id', reportId)
      .order('created_at', { ascending: true })
    setLoading(false)
    if (error) {
      debugWarn('comments', 'list failed', { error: error.message })
      return
    }
    setComments((data ?? []) as ReportCommentRow[])
  }, [reportId])

  useEffect(() => {
    if (!reportId) return
    void refresh()
    const uid = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const channel = supabase
      .channel(`mushi:report-comments:${reportId}:${uid}`)
      .on('postgres_changes' as never,
        { event: '*', schema: 'public', table: 'report_comments', filter: `report_id=eq.${reportId}` } as never,
        () => { void refresh() },
      )
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [reportId, refresh])

  const postComment = useCallback(async (body: string, options?: { visibleToReporter?: boolean; parentId?: number }) => {
    if (!reportId || !projectId) return
    const trimmed = body.trim()
    if (!trimmed) return
    const { data: sess } = await supabase.auth.getUser()
    const me = sess.user
    if (!me) {
      // Throwing so the caller can surface a toast; previous silent return
      // looked indistinguishable from a successful post.
      throw new Error('You must be signed in to comment.')
    }
    const { error } = await supabase.from('report_comments').insert({
      report_id: reportId,
      project_id: projectId,
      author_user_id: me.id,
      author_kind: 'admin',
      author_name: me.user_metadata?.full_name ?? me.email ?? null,
      body: trimmed,
      visible_to_reporter: options?.visibleToReporter ?? false,
      parent_id: options?.parentId ?? null,
    })
    if (error) {
      debugWarn('comments', 'insert failed', { error: error.message })
      throw new Error(commentWriteErrorText(error, 'post'))
    }
  }, [reportId, projectId])

  const deleteComment = useCallback(async (id: number) => {
    // RLS lets authors delete only their own comments; a blocked delete
    // removes 0 rows and returns NO error, so count what was deleted.
    const { data, error } = await supabase.from('report_comments').delete().eq('id', id).select('id')
    if (error) {
      debugWarn('comments', 'delete failed', { error: error.message })
      throw new Error(commentWriteErrorText(error, 'delete'))
    }
    if (!data || data.length === 0) {
      throw new Error('You can only delete comments you wrote.')
    }
    await refresh()
  }, [refresh])

  return { comments, loading, currentUserId, postComment, deleteComment }
}
