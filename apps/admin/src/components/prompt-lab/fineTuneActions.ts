/**
 * FILE: apps/admin/src/components/prompt-lab/fineTuneActions.ts
 * PURPOSE: Fine-tuning job lifecycle controls, kept pure for tests.
 */

import type { FineTuningJob } from './types'

/**
 * Which lifecycle controls a job shows. Every status has a way forward:
 * pending → Export → exported → Submit → training → Check status → trained →
 * Validate → validated → Promote. (Submit and Check status were missing, so
 * every job stopped at "exported".)
 */
export function fineTuneNextActions(job: Pick<FineTuningJob, 'status' | 'validation_report'>) {
  const status = job.status
  return {
    canExport: status === 'pending' || status === 'rejected' || status === 'failed',
    canSubmit: status === 'exported',
    canPoll: status === 'training',
    canValidate: status === 'trained' || status === 'rejected',
    canPromote: status === 'validated' || (status === 'trained' && (job.validation_report?.passed ?? false)),
    canReject: status !== 'rejected' && status !== 'promoted' && status !== 'pending',
  }
}

/**
 * Fine-tuning lives in this page's Advanced section. The old /fine-tuning route opened AI
 * prompts with that section closed (round-2 review, 2026-11-18): `?tab=fine-tuning` opens
 * it and brings it into view. Read by PromptLabPage.
 */
export function opensFineTuning(tab: string | null): boolean {
  return tab === 'fine-tuning' || tab === 'fine_tuning' || tab === 'advanced'
}
