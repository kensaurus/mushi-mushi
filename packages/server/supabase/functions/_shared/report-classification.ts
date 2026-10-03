/**
 * FILE: packages/server/supabase/functions/_shared/report-classification.ts
 * PURPOSE: Queue a report created outside the api (store review intake) for
 *          classification: the stage-1 processing_queue row plus a
 *          fire-and-forget fast-filter call, the same two effects
 *          `api/helpers.ts triggerClassification` and voice intake produce.
 *          A failed call flips the queue row to `failed` so the
 *          status-reconciler retries it; the report itself is already saved.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { log as rootLog } from './logger.ts'

const log = rootLog.child('report-classification')

export async function queueReportClassification(db: SupabaseClient, reportId: string, projectId: string): Promise<void> {
  const { error: queueError } = await db
    .from('processing_queue')
    .upsert(
      { report_id: reportId, project_id: projectId, stage: 'stage1', status: 'pending' },
      { onConflict: 'report_id,stage', ignoreDuplicates: true },
    )
  if (queueError && queueError.code !== '23505') {
    log.error('queueing the report for classification failed', { reportId, errMsg: queueError.message })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceKey) return

  const markFailed = (lastError: string) =>
    db
      .from('processing_queue')
      .update({ status: 'failed', last_error: lastError.slice(0, 300), completed_at: new Date().toISOString() })
      .eq('report_id', reportId)
      .eq('status', 'pending')
      .then(() => undefined, () => undefined)

  void fetch(`${supabaseUrl}/functions/v1/fast-filter`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
    body: JSON.stringify({ reportId, projectId }),
    signal: AbortSignal.timeout(60_000),
  })
    .then(async (res) => {
      if (res.ok) {
        await db
          .from('processing_queue')
          .update({ status: 'completed', completed_at: new Date().toISOString() })
          .eq('report_id', reportId)
          .eq('status', 'pending')
        return
      }
      const body = (await res.text().catch(() => '')).slice(0, 200)
      await markFailed(`Stage 1 failed: ${res.status} ${body}`)
    })
    .catch((err) => markFailed(String(err)))
}
