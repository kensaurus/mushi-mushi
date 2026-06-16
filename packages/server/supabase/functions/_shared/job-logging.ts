/**
 * FILE: job-logging.ts
 * PURPOSE: Uniform start/done/failed logging for edge-function workers.
 *
 * USAGE:
 *   await withJobLogging('classify-report', { reportId }, () => runPipeline())
 */

import { log } from './logger.ts'

export interface JobLogMeta extends Record<string, unknown> {
  requestId?: string
}

/** Wrap an async worker body with job.start / job.done / job.failed events. */
export async function withJobLogging<T>(
  jobName: string,
  meta: JobLogMeta,
  fn: () => Promise<T>,
): Promise<T> {
  const jobLog = log.child(`job:${jobName}`, meta)
  const started = Date.now()
  jobLog.info('job.start', meta)
  try {
    const result = await fn()
    jobLog.info('job.done', { ...meta, durationMs: Date.now() - started })
    return result
  } catch (err) {
    jobLog.error('job.failed', {
      ...meta,
      durationMs: Date.now() - started,
      err: err instanceof Error ? err.message : String(err),
    })
    throw err
  }
}
