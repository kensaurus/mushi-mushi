// FILE: scripts/pipeline-recover.mjs
// PURPOSE: One-shot + cron-friendly recovery for stranded Mushi reports.
//
// Re-invokes fast-filter for:
//   1. reports.status='new'   AND created_at < now() - 5min  (never picked up)
//   2. reports.status='queued' AND created_at < now() - 5min  (admin requeues)
//   3. processing_queue.status IN ('pending','failed') AND attempts < max_attempts
//
// USAGE:
//   SUPABASE_URL=https://dxptnwrhwsqckaftyymj.supabase.co \
//   SUPABASE_KEY=sb_publishable_xxx \
//   node scripts/pipeline-recover.mjs
//
// Notes:
// - SUPABASE_KEY accepts either the publishable anon key or the service role
//   key. Both work because every edge function is deployed with verify_jwt
//   disabled. The PostgREST queries here only need read+update against tables
//   the publishable key can already see via RLS for the e2e-test admin, so
//   anon key is preferred for least-privilege.
// - Designed to be invoked by `mushi-pipeline-recovery-5m` pg_cron job and
//   safely re-run by hand (idempotent — fast-filter no-ops on already
//   classified reports).

import process from "node:process";

const SUPABASE_URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !KEY) {
  console.error("Missing env: set SUPABASE_URL and SUPABASE_KEY (publishable or service role).");
  process.exit(1);
}

const RECOVER_AGE_MIN = Number(process.env.RECOVER_AGE_MIN ?? 5);
const MAX_PER_RUN = Number(process.env.RECOVER_MAX ?? 100);

const tag = "\x1b[2m[pipeline-recover]\x1b[0m";

const headers = {
  "Content-Type": "application/json",
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
};

async function rest(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers });
  if (!res.ok) throw new Error(`REST ${path} -> ${res.status}: ${await res.text()}`);
  return res.json();
}

async function patch(path, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: "PATCH",
    headers: { ...headers, Prefer: "return=minimal" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PATCH ${path} -> ${res.status}: ${await res.text()}`);
}

async function invokeFastFilter(reportId, projectId) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/fast-filter`, {
    method: "POST",
    headers,
    body: JSON.stringify({ reportId, projectId }),
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, body: text.slice(0, 200) };
}

async function findStrandedReports() {
  const cutoff = new Date(Date.now() - RECOVER_AGE_MIN * 60_000).toISOString();
  return rest(
    `reports?select=id,project_id,status,created_at` +
      `&status=in.(new,queued)` +
      `&created_at=lt.${encodeURIComponent(cutoff)}` +
      `&order=created_at.asc&limit=${MAX_PER_RUN}`,
  );
}

async function findFailedQueueItems() {
  return rest(
    `processing_queue?select=id,report_id,attempts,max_attempts,status` +
      `&status=in.(failed,pending)` +
      `&attempts=lt.max_attempts` +
      `&order=created_at.asc&limit=${MAX_PER_RUN}`,
  );
}

async function reconcileCompletedQueue() {
  const stale = await rest(
    `processing_queue?select=id,report_id,reports(status)` +
      `&status=eq.pending` +
      `&order=created_at.asc&limit=${MAX_PER_RUN}`,
  );
  const completedIds = stale
    .filter((q) => q.reports && ["classified", "dispatched", "completed"].includes(q.reports.status))
    .map((q) => q.id);
  if (completedIds.length === 0) return 0;
  await patch(`processing_queue?id=in.(${completedIds.join(",")})`, {
    status: "completed",
    completed_at: new Date().toISOString(),
  });
  return completedIds.length;
}

async function main() {
  console.log(`${tag} starting (age>=${RECOVER_AGE_MIN}min, max=${MAX_PER_RUN})`);

  const reconciled = await reconcileCompletedQueue();
  if (reconciled > 0) console.log(`${tag} reconciled ${reconciled} completed queue items`);

  const stranded = await findStrandedReports();
  console.log(`${tag} found ${stranded.length} stranded reports`);

  let ok = 0;
  let fail = 0;
  for (const r of stranded) {
    try {
      const result = await invokeFastFilter(r.id, r.project_id);
      if (result.ok) {
        ok++;
        console.log(`${tag} \x1b[32m✓\x1b[0m fast-filter ${r.id} (${r.created_at})`);
      } else {
        fail++;
        console.error(`${tag} \x1b[31m✗\x1b[0m fast-filter ${r.id} -> ${result.status} ${result.body}`);
      }
    } catch (err) {
      fail++;
      console.error(`${tag} \x1b[31m✗\x1b[0m fast-filter ${r.id} threw: ${String(err)}`);
    }
  }

  const failedQueue = await findFailedQueueItems();
  console.log(`${tag} found ${failedQueue.length} retryable queue items`);
  for (const q of failedQueue) {
    try {
      await patch(`processing_queue?id=eq.${q.id}`, { status: "pending", scheduled_at: new Date().toISOString() });
      const report = await rest(`reports?select=id,project_id,status&id=eq.${q.report_id}`);
      if (!report[0] || report[0].status !== "new") continue;
      const result = await invokeFastFilter(report[0].id, report[0].project_id);
      if (result.ok) {
        ok++;
        console.log(`${tag} \x1b[32m✓\x1b[0m queue-retry ${q.id} -> report ${q.report_id}`);
      } else {
        fail++;
        console.error(`${tag} \x1b[31m✗\x1b[0m queue-retry ${q.id} -> ${result.status} ${result.body}`);
      }
    } catch (err) {
      fail++;
      console.error(`${tag} \x1b[31m✗\x1b[0m queue-retry ${q.id} threw: ${String(err)}`);
    }
  }

  console.log(`${tag} done. ok=${ok} fail=${fail} reconciled=${reconciled}`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(`${tag} fatal:`, err);
  process.exit(1);
});
