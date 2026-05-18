// ============================================================
// quest-tracker.ts — P3 multi-step goal tracking
//
// Called by the activity ingest route (POST /v1/sdk/activity)
// after points are awarded. For each incoming activity event,
// advances any in-progress quest_progress rows where the next
// step matches the action (and optionally the metadata).
//
// On quest completion:
//   - Inserts bonus points into end_user_activity.
//   - Fires dispatchPluginEvent('reward.quest_completed').
//   - Dispatches host webhook if configured.
// ============================================================

import { getServiceClient } from './db.ts'
import { awardPointsForEndUser } from './reputation.ts'
import { dispatchRewardWebhook } from './reward-webhooks.ts'
import { log } from './logger.ts'

const qlog = log.child('quest-tracker')

interface QuestStep {
  action: string
  label: string
  /** Optional subset of metadata keys that must match */
  metadata_match?: Record<string, unknown>
}

interface QuestRow {
  id: string
  name: string
  organization_id: string
  steps: QuestStep[]
  completion_points: number
  repeatable: boolean
  expires_after_days: number | null
}

interface ProgressRow {
  id: string
  quest_id: string
  end_user_id: string
  organization_id: string
  next_step_index: number
  status: string
  expires_at: string | null
}

function metadataMatches(
  eventMeta: Record<string, unknown>,
  requiredMatch: Record<string, unknown> | undefined,
): boolean {
  if (!requiredMatch) return true
  for (const [k, v] of Object.entries(requiredMatch)) {
    if (eventMeta[k] !== v) return false
  }
  return true
}

export async function evaluateQuestProgress(opts: {
  endUserId: string
  organizationId: string
  projectId: string
  action: string
  metadata: Record<string, unknown>
  activityId: string
}): Promise<void> {
  const db = getServiceClient()
  const { endUserId, organizationId, projectId, action, metadata, activityId } = opts

  // 1. Load enabled quests for this org (+ project-specific)
  const { data: quests } = await db
    .from('reward_quests')
    .select('id, name, organization_id, steps, completion_points, repeatable, expires_after_days')
    .eq('organization_id', organizationId)
    .eq('enabled', true) as { data: QuestRow[] | null }

  if (!quests || quests.length === 0) return

  for (const quest of quests) {
    const steps = quest.steps as QuestStep[]
    if (!steps || steps.length === 0) continue

    // 2. Find or create in-progress row for this user + quest
    const { data: existing } = await db
      .from('quest_progress')
      .select('id, next_step_index, status, expires_at')
      .eq('quest_id', quest.id)
      .eq('end_user_id', endUserId)
      .eq('status', 'in_progress')
      .single() as { data: ProgressRow | null }

    let progressId: string
    let nextStepIndex: number

    if (!existing) {
      // Start a new quest progress row — but only if the first step matches
      const firstStep = steps[0]
      if (!firstStep || firstStep.action !== action || !metadataMatches(metadata, firstStep.metadata_match)) continue

      const expiresAt = quest.expires_after_days
        ? new Date(Date.now() + quest.expires_after_days * 86400 * 1000).toISOString()
        : null

      const { data: created } = await db
        .from('quest_progress')
        .insert({
          quest_id: quest.id,
          end_user_id: endUserId,
          organization_id: organizationId,
          next_step_index: 1, // step 0 just matched
          status: steps.length === 1 ? 'completed' : 'in_progress',
          ...(expiresAt ? { expires_at: expiresAt } : {}),
          ...(steps.length === 1 ? { completed_at: new Date().toISOString(), completing_activity_id: activityId } : {}),
        })
        .select('id, next_step_index, status')
        .single() as { data: ProgressRow | null }

      if (!created) continue
      progressId = created.id
      nextStepIndex = created.next_step_index

      if (steps.length === 1) {
        // Immediately completed
        await onQuestCompleted({ quest, endUserId, organizationId, projectId, progressId })
        continue
      }
    } else {
      // Check expiry
      if (existing.expires_at && new Date(existing.expires_at) < new Date()) {
        await db.from('quest_progress').update({ status: 'expired', updated_at: new Date().toISOString() }).eq('id', existing.id)
        continue
      }

      progressId = existing.id
      nextStepIndex = existing.next_step_index

      // Check if current action matches the next expected step
      const nextStep = steps[nextStepIndex]
      if (!nextStep || nextStep.action !== action || !metadataMatches(metadata, nextStep.metadata_match)) continue

      const newIndex = nextStepIndex + 1
      const isComplete = newIndex >= steps.length

      await db.from('quest_progress')
        .update({
          next_step_index: newIndex,
          ...(isComplete ? {
            status: 'completed',
            completed_at: new Date().toISOString(),
            completing_activity_id: activityId,
          } : {}),
          updated_at: new Date().toISOString(),
        })
        .eq('id', progressId)

      if (isComplete) {
        await onQuestCompleted({ quest, endUserId, organizationId, projectId, progressId })
      }
    }
  }
}

async function onQuestCompleted(opts: {
  quest: QuestRow
  endUserId: string
  organizationId: string
  projectId: string
  progressId: string
}): Promise<void> {
  const { quest, endUserId, organizationId, projectId } = opts

  qlog.info('quest_completed', { questId: quest.id, endUserId, points: quest.completion_points })

  if (quest.completion_points > 0) {
    try {
      await awardPointsForEndUser(getServiceClient(), {
        projectId,
        organizationId,
        endUserId,
        action: `quest_completed:${quest.id}`,
        metadata: { quest_id: quest.id, quest_name: quest.name },
        reporterTokenHash: null,
      })
    } catch (err) {
      qlog.warn('quest_bonus_award_failed', { questId: quest.id, error: String(err) })
    }
  }

  // Fire host webhook
  try {
    await dispatchRewardWebhook(getServiceClient(), organizationId, {
      event: 'reward.quest_completed',
      end_user_id: endUserId,
      occurred_at: new Date().toISOString(),
      quest_id: quest.id,
      quest_name: quest.name,
      bonus_points: quest.completion_points,
    })
  } catch (err) {
    qlog.warn('quest_webhook_failed', { questId: quest.id, error: String(err) })
  }
}
