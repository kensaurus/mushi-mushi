import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import { debugWarn } from './debug'

export interface ReportCommentRow {
  id: number
  report_id: string
  project_id: string
  author_user_id: string | null
  author_name: string | null
  body: string
  visible_to_reporter: boolean
  parent_id: number | null
  edited_at: string | null
  created_at: string
}

export interface UseReportCommentsOptions {
  reportId: string | undefined
  projectId: string | undefined
}

export function useReportComments(opts: UseReportCommentsOptions): {
  comments: ReportCommentRow[]
  loading: boolean
  postComment: (body: string, options?: { visibleToReporter?: boolean; parentId?: number }) => Promise<void>
  deleteComment: (id: number) => Promise<void>
} {
  const { reportId, projectId } = opts
  const [comments, setComments] = useState<ReportCommentRow[]>([])
  const [loading, setLoading] = useState(false)

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
    const channel = supabase
      .channel(`mushi:report-comments:${reportId}`)
      .on('postgres_changes' as never,
        { event: '*', schema: 'public', table: 'report_comments', filter: `report_id=eq.${reportId}` } as never,
        () => { void refresh() },
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [reportId, refresh])

  const postComment = useCallback(async (body: string, options?: { visibleToReporter?: boolean; parentId?: number }) => {
    if (!reportId || !projectId) return
    const trimmed = body.trim()
    if (!trimmed) return
    const { data: sess } = await supabase.auth.getUser()
    const me = sess.user
    if (!me) return
    const { error } = await supabase.from('report_comments').insert({
      report_id: reportId,
      project_id: projectId,
      author_user_id: me.id,
      author_name: me.user_metadata?.full_name ?? me.email ?? null,
      body: trimmed,
      visible_to_reporter: options?.visibleToReporter ?? false,
      parent_id: options?.parentId ?? null,
    })
    if (error) debugWarn('comments', 'insert failed', { error: error.message })
  }, [reportId, projectId])

  const deleteComment = useCallback(async (id: number) => {
    const { error } = await supabase.from('report_comments').delete().eq('id', id)
    if (error) debugWarn('comments', 'delete failed', { error: error.message })
  }, [])

  return { comments, loading, postComment, deleteComment }
}
