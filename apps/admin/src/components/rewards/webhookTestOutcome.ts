/**
 * FILE: apps/admin/src/components/rewards/webhookTestOutcome.ts
 * PURPOSE: Toast copy for Rewards → Settings "Send test event", from what each
 *          endpoint actually answered (POST /v1/admin/rewards/webhooks/test).
 *          It used to say "Test webhook delivered" whatever happened.
 */

export interface WebhookTestSummary {
  attempted: number
  delivered: number
  failed: number
  results: Array<{ url: string; status: number; ok: boolean; skipped?: string }>
}

export function describeWebhookTest(
  summary: WebhookTestSummary | undefined,
): { ok: boolean; title: string; detail?: string } {
  if (!summary || summary.attempted === 0) {
    return {
      ok: false,
      title: 'No enabled webhook to test',
      detail: 'Add a webhook, or turn one back on, then send the test again.',
    }
  }
  if (summary.failed === 0) {
    const n = summary.delivered
    return { ok: true, title: `Test event delivered to ${n} webhook${n === 1 ? '' : 's'}` }
  }
  const failures = summary.results
    .filter((r) => !r.ok)
    .map((r) =>
      r.skipped === 'no_secret'
        ? `${r.url} (no signing secret stored — delete and re-add it)`
        : `${r.url} (${r.status ? `HTTP ${r.status}` : 'no response'})`,
    )
  return {
    ok: false,
    title: `${summary.failed} of ${summary.attempted} webhook${summary.attempted === 1 ? '' : 's'} did not accept the test event`,
    detail: `${failures.join(', ')}. Make sure the endpoint is up and answers with a 2xx status.`,
  }
}
