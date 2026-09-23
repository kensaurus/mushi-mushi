/**
 * FILE: api/routes/intelligence-priority.ts
 * PURPOSE: Decide whether the newest intelligence generation job's failure is
 *          still the current state of the pipeline, for GET
 *          /v1/admin/intelligence/stats (intelligence-synthetic.ts).
 *
 *          Deliberately import-free so intelligence-priority.test.ts can run
 *          under CI's permission-less `deno test` (the route module pulls in
 *          _shared/*, which reads env at import time — see dispatch-dry-run.ts).
 */

export interface GenerationJobLike {
  status: string;
  created_at: string;
  finished_at?: string | null;
}

export interface DigestLike {
  created_at: string | null;
}

/**
 * True when the latest generation job failed but a digest was written after
 * it. The weekly cron writes `intelligence_reports` directly, not through
 * `intelligence_generation_jobs`, so the newest *job* can be months older than
 * the newest *digest*. Without this, glot.it's manual run that failed on
 * 2026-05-19 stayed the page's headline through seventeen successful weekly
 * digests. A failure with no newer digest is still current and still leads.
 */
export function isJobFailureSuperseded(
  job: GenerationJobLike | null,
  digests: readonly DigestLike[],
): boolean {
  if (!job || job.status !== 'failed') return false;
  const failedAt = Date.parse(job.finished_at ?? job.created_at);
  if (!Number.isFinite(failedAt)) return false;
  return digests.some((d) => d.created_at != null && Date.parse(d.created_at) > failedAt);
}
