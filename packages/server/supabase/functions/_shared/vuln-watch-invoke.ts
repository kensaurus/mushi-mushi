/**
 * FILE: packages/server/supabase/functions/_shared/vuln-watch-invoke.ts
 * PURPOSE: Ask the vuln-watch function (ADR 0038) to check one project now,
 *          fire and forget. No other imports, so `api` (at its deploy size
 *          limit) can call it from POST /radar/run without the parsers.
 */

import { runInBackground } from './background.ts'

export function invokeVulnWatch(projectId: string): void {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const internalSecret = Deno.env.get('MUSHI_INTERNAL_CALLER_SECRET') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !internalSecret) return
  // The daily cron checks the project anyway if this call is lost.
  runInBackground(
    fetch(`${supabaseUrl}/functions/v1/vuln-watch`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${internalSecret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, trigger: 'manual' }),
    }),
    'vuln-watch check now',
  )
}
