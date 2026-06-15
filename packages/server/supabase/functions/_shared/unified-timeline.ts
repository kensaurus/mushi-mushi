/**
 * Unified report timeline — merges reporter comments, fix events, skill/QA pipeline
 * steps, and Ask Mushi turns into one ordered feed without merging underlying tables.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

export type UnifiedTimelineLane =
  | 'report'
  | 'reporter_comment'
  | 'admin_comment'
  | 'fix'
  | 'qa'
  | 'skill_pipeline'
  | 'ask_mushi'

export interface UnifiedTimelineEntry {
  id: string
  lane: UnifiedTimelineLane
  at: string
  title: string
  body?: string | null
  status?: string | null
  actor?: string | null
  links?: Record<string, string>
}

export async function buildUnifiedReportTimeline(
  db: SupabaseClient,
  projectId: string,
  reportId: string,
): Promise<UnifiedTimelineEntry[]> {
  const entries: UnifiedTimelineEntry[] = []

  const { data: report } = await db
    .from('reports')
    .select('id, status, description, category, created_at')
    .eq('id', reportId)
    .eq('project_id', projectId)
    .maybeSingle()

  if (!report) return []

  entries.push({
    id: `report-${report.id}`,
    lane: 'report',
    at: report.created_at,
    title: 'Report submitted',
    body: report.description,
    status: report.status,
    actor: 'reporter',
  })

  const { data: comments } = await db
    .from('report_comments')
    .select('id, body, author_kind, created_at')
    .eq('report_id', reportId)
    .eq('project_id', projectId)
    .order('created_at', { ascending: true })
    .limit(200)

  for (const c of comments ?? []) {
    entries.push({
      id: `comment-${c.id}`,
      lane: c.author_kind === 'admin' ? 'admin_comment' : 'reporter_comment',
      at: c.created_at,
      title: c.author_kind === 'admin' ? 'Team reply' : 'Reporter reply',
      body: c.body,
      actor: c.author_kind,
    })
  }

  // `report_groups` has no `fix_id` column — the canonical fix linkage is the
  // most-recent `fix_attempts` row for this report.
  const { data: fixRow } = await db
    .from('fix_attempts')
    .select('id')
    .eq('report_id', reportId)
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const fixId: string | null = fixRow?.id ?? null

  if (fixId) {
    const { data: fixEvents } = await db
      .from('fix_events')
      .select('id, kind, label, detail, status, at')
      .eq('fix_attempt_id', fixId)
      .order('at', { ascending: true })
      .limit(100)

    for (const e of fixEvents ?? []) {
      entries.push({
        id: `fix-${e.id ?? e.kind}-${e.at}`,
        lane: 'fix',
        at: e.at,
        title: e.label ?? e.kind,
        body: e.detail,
        status: e.status,
        links: { fix_id: fixId },
      })
    }
  }

  // QA runs are keyed by `story_id`, not `report_id`. Resolve the stories that
  // originated from this report (`qa_stories.origin_report_id`) and pull their runs.
  const { data: reportStories } = await db
    .from('qa_stories')
    .select('id')
    .eq('project_id', projectId)
    .eq('origin_report_id', reportId)
    .limit(20)

  const storyIds = (reportStories ?? []).map((s) => s.id)
  if (storyIds.length > 0) {
    const { data: qaRuns } = await db
      .from('qa_story_runs')
      .select('id, status, started_at, finished_at, error_message')
      .in('story_id', storyIds)
      .order('started_at', { ascending: true })
      .limit(20)

    for (const run of qaRuns ?? []) {
      entries.push({
        id: `qa-${run.id}`,
        lane: 'qa',
        at: run.finished_at ?? run.started_at,
        title: `QA run ${run.status}`,
        body: run.error_message,
        status: run.status,
        links: { run_id: run.id },
      })
    }
  }

  const { data: pipelines } = await db
    .from('skill_pipeline_runs')
    .select('id, status, created_at, root_skill_slug')
    .eq('report_id', reportId)
    .eq('project_id', projectId)
    .order('created_at', { ascending: true })
    .limit(20)

  for (const p of pipelines ?? []) {
    entries.push({
      id: `pipeline-${p.id}`,
      lane: 'skill_pipeline',
      at: p.created_at,
      title: `Skill pipeline: ${p.root_skill_slug ?? 'workflow'}`,
      status: p.status,
      links: { pipeline_run_id: p.id },
    })
  }

  // Ask Mushi turns anchor to an entity via `selection_id` (text); there is no
  // dedicated `report_id` column.
  const { data: askTurns } = await db
    .from('ask_mushi_messages')
    .select('id, role, content, created_at')
    .eq('project_id', projectId)
    .eq('selection_id', reportId)
    .order('created_at', { ascending: true })
    .limit(50)

  for (const m of askTurns ?? []) {
    entries.push({
      id: `ask-${m.id}`,
      lane: 'ask_mushi',
      at: m.created_at,
      title: m.role === 'user' ? 'Ask Mushi question' : 'Ask Mushi answer',
      body: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      actor: m.role,
    })
  }

  entries.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
  return entries
}
