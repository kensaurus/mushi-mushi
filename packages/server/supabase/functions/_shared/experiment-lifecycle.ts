/**
 * FILE: packages/server/supabase/functions/_shared/experiment-lifecycle.ts
 * PURPOSE: Which experiment status changes are allowed. The launch / stop /
 *          delete routes used to write whatever they were asked and answer
 *          `{ ok: true }` even when nothing changed, so the console reported
 *          "Experiment launched" for a draft with one variant or a DB error.
 */

export type ExperimentStatus = 'draft' | 'running' | 'stopped' | 'completed'
export type ExperimentAction = 'launch' | 'stop' | 'delete'

/** Fewest variants an A/B test needs: a control and one treatment. */
export const MIN_VARIANTS_TO_LAUNCH = 2

/**
 * null when `action` may run on an experiment in `status` with
 * `variantCount` variants, else the plain-English reason it may not.
 */
export function experimentTransitionError(
  action: ExperimentAction,
  status: ExperimentStatus | string,
  variantCount: number,
): string | null {
  switch (action) {
    case 'launch':
      if (status !== 'draft') return `This experiment is already ${status}; only a draft can be launched.`
      if (variantCount < MIN_VARIANTS_TO_LAUNCH) {
        return `Add at least ${MIN_VARIANTS_TO_LAUNCH} variants (a control and a treatment) before launching. It has ${variantCount}.`
      }
      return null
    case 'stop':
      return status === 'running' ? null : `This experiment is ${status}; only a running experiment can be stopped.`
    case 'delete':
      return status === 'draft' ? null : `Only drafts can be deleted. Stop the experiment instead; this one is ${status}.`
  }
}
