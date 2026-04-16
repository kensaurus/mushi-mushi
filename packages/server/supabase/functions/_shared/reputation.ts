import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

interface PointAction {
  action: 'submit' | 'confirmed' | 'fixed' | 'first_on_component' | 'screenshot' | 'element_select' | 'dismissed'
}

const POINT_TABLE: Record<string, { base: number; useMultiplier: boolean }> = {
  submit:              { base: 10,  useMultiplier: true },
  confirmed:           { base: 50,  useMultiplier: false },
  fixed:               { base: 25,  useMultiplier: false },
  first_on_component:  { base: 15,  useMultiplier: true },
  screenshot:          { base: 5,   useMultiplier: false },
  element_select:      { base: 5,   useMultiplier: false },
  dismissed:           { base: -5,  useMultiplier: false },
}

function clamp(val: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, val))
}

function computeReputation(confirmed: number, dismissed: number): number {
  const raw = confirmed / (confirmed + dismissed + 1)
  return clamp(raw, 0.1, 2.0)
}

export async function awardPoints(
  db: SupabaseClient,
  projectId: string,
  reporterTokenHash: string,
  action: PointAction,
): Promise<{ points: number; totalPoints: number; reputation: number }> {
  const config = POINT_TABLE[action.action]
  if (!config) return { points: 0, totalPoints: 0, reputation: 1.0 }

  const { data: existing } = await db
    .from('reporter_reputation')
    .select('*')
    .eq('project_id', projectId)
    .eq('reporter_token_hash', reporterTokenHash)
    .single()

  const current = existing ?? {
    reputation_score: 1.0,
    total_points: 0,
    confirmed_bugs: 0,
    dismissed_reports: 0,
    total_reports: 0,
  }

  const multiplier = config.useMultiplier ? current.reputation_score : 1.0
  const points = Math.round(config.base * multiplier)

  const updates: Record<string, unknown> = {
    total_points: current.total_points + points,
    reputation_score: current.reputation_score,
  }

  if (action.action === 'submit') {
    updates.total_reports = current.total_reports + 1
  } else if (action.action === 'confirmed') {
    updates.confirmed_bugs = current.confirmed_bugs + 1
    updates.reputation_score = computeReputation(
      current.confirmed_bugs + 1,
      current.dismissed_reports,
    )
  } else if (action.action === 'dismissed') {
    updates.dismissed_reports = current.dismissed_reports + 1
    updates.reputation_score = computeReputation(
      current.confirmed_bugs,
      current.dismissed_reports + 1,
    )
  }

  if (existing) {
    await db.from('reporter_reputation')
      .update(updates)
      .eq('id', existing.id)
  } else {
    await db.from('reporter_reputation').insert({
      project_id: projectId,
      reporter_token_hash: reporterTokenHash,
      ...updates,
    })
  }

  return {
    points,
    totalPoints: (updates.total_points as number),
    reputation: updates.reputation_score as number,
  }
}

export async function getReputation(
  db: SupabaseClient,
  projectId: string,
  reporterTokenHash: string,
): Promise<{ reputation: number; totalPoints: number; confirmedBugs: number; totalReports: number }> {
  const { data } = await db
    .from('reporter_reputation')
    .select('reputation_score, total_points, confirmed_bugs, total_reports')
    .eq('project_id', projectId)
    .eq('reporter_token_hash', reporterTokenHash)
    .single()

  return {
    reputation: data?.reputation_score ?? 1.0,
    totalPoints: data?.total_points ?? 0,
    confirmedBugs: data?.confirmed_bugs ?? 0,
    totalReports: data?.total_reports ?? 0,
  }
}
