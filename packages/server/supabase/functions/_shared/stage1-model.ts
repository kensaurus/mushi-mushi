/**
 * FILE: packages/server/supabase/functions/_shared/stage1-model.ts
 * PURPOSE: Which Claude model fast-filter (Stage 1) calls for a project.
 *
 * `project_settings.stage1_model` was stored but never read: fast-filter
 * always called STAGE1_MODEL, so a project could not move its quick check to
 * a cheaper model (the-wanting-mind → Haiku 5.5, owner 2026-10-09).
 *
 * Unset keeps the exact request fast-filter has always sent (Haiku 4.5
 * through AI SDK v4, temperature allowed). A model that rejects sampling
 * knobs (every 5.x, Opus 4.7+) cannot take that call shape, so it goes
 * through `claude-messages.ts` instead. A non-Claude id is ignored: Stage 1's
 * primary path is Anthropic; OpenAI is only its fallback.
 */
import { claudeModelTraits, resolveClaudeModel } from './claude-request.ts'
import { STAGE1_MODEL } from './models.ts'

export interface Stage1ModelChoice {
  model: string
  /** True: call through claude-messages.ts. False: the AI SDK v4 path. */
  messagesApi: boolean
}

export function resolveStage1Model(stored: string | null | undefined): Stage1ModelChoice {
  const raw = (stored ?? '').trim()
  const model = /^claude-/.test(raw) ? resolveClaudeModel(raw, STAGE1_MODEL) : STAGE1_MODEL
  return { model, messagesApi: !claudeModelTraits(model).acceptsSampling }
}

const CLAUDE_MODEL_ID = /^claude-[a-z0-9]+(-[a-z0-9]+){1,5}$/

/**
 * Settings PATCH rule for `stage1_model` and `judge_model`. Both call Claude
 * first (fast-filter, judge-batch), so a `gpt-*` id here would make every
 * call fail: only Claude ids are accepted.
 */
export function parseClaudeModelSetting(
  value: unknown,
): { ok: true; value: string } | { ok: false; message: string } {
  const id = typeof value === 'string' ? value.trim() : ''
  if (!CLAUDE_MODEL_ID.test(id)) {
    return { ok: false, message: 'Pick a Claude model, such as claude-haiku-5-5 or claude-sonnet-5-5.' }
  }
  return { ok: true, value: id }
}
