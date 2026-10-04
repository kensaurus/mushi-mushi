/**
 * FILE: apps/admin/src/lib/skillPipelines.ts
 * PURPOSE: Pure rules behind /skills (console QA group C, 2026-10-04):
 *   - which tab a `?tab=` value opens (QA 245: `?tab=foo` crashed the page);
 *   - reading a report id out of whatever the user pasted (QA 103: the field
 *     invited an 8-character id the server can never match);
 *   - what a Cancel actually did to the cloud agents (QA 24);
 *   - which step a handoff check-in applies to (QA 105).
 */

export type SkillsTab = 'catalog' | 'pipelines' | 'sources'

export function resolveSkillsTab(value: string | null | undefined): SkillsTab {
  return value === 'pipelines' || value === 'sources' ? value : 'catalog'
}

const UUID_IN_TEXT = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

export type ReportIdInput =
  | { kind: 'empty' }
  | { kind: 'ok'; id: string }
  | { kind: 'invalid'; message: string }

/**
 * Accepts a bare report id or a pasted report URL (`…/reports/<id>`).
 * A short id is refused with the fix, not sent: the server matches full ids
 * within this project only.
 */
export function parseReportIdInput(raw: string): ReportIdInput {
  const text = raw.trim()
  if (!text) return { kind: 'empty' }
  const match = UUID_IN_TEXT.exec(text)
  if (match) return { kind: 'ok', id: match[0].toLowerCase() }
  return {
    kind: 'invalid',
    message:
      'Paste the full report ID (36 characters, like 0f7f2b1a-1111-4222-8333-444455556666) or the report’s page link. Open the report and copy it from the address bar.',
  }
}

export interface PipelineCancelResult {
  mode?: string
  stopped?: number
  stillRunning?: number
}

/** The toast after Cancel: never "cancelled" alone while an agent may still push. */
export function describePipelineCancel(result: PipelineCancelResult | null | undefined): {
  tone: 'success' | 'warn'
  message: string
} {
  const still = result?.stillRunning ?? 0
  if (still > 0) {
    return {
      tone: 'warn',
      message: `Pipeline cancelled, but ${still === 1 ? 'one Cursor Cloud agent' : `${still} Cursor Cloud agents`} could not be stopped and may still push a branch or open a PR. Stop ${still === 1 ? 'it' : 'them'} at cursor.com/agents.`,
    }
  }
  const stopped = result?.stopped ?? 0
  if (stopped > 0) {
    return {
      tone: 'success',
      message: `Pipeline cancelled and its Cursor Cloud ${stopped === 1 ? 'agent was' : 'agents were'} stopped.`,
    }
  }
  return { tone: 'success', message: 'Pipeline cancelled. No more steps will run.' }
}

/** Body of the Cancel confirm dialog, honest about what Mushi can stop. */
export function pipelineCancelBody(mode: string | null | undefined): string {
  if (mode === 'cloud') {
    return 'Mushi stops the pipeline and asks Cursor Cloud to stop the agent working on the current step. Steps that have not started are skipped. Work an agent already pushed stays on its branch. This cannot be undone.'
  }
  return 'Mushi stops the pipeline and skips the steps that have not finished. Your local agent is not stopped: close it in your editor. This cannot be undone.'
}

export interface CheckinStep {
  step_index: number
  status: string
}

/** The step a manual check-in applies to: the first one not finished yet. */
export function nextCheckinStep<T extends CheckinStep>(steps: readonly T[]): T | null {
  const ordered = [...steps].sort((a, b) => a.step_index - b.step_index)
  return ordered.find((s) => s.status === 'pending' || s.status === 'running') ?? null
}
