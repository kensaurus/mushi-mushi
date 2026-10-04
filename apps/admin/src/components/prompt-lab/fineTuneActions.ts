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
