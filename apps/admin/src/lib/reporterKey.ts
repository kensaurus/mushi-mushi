/**
 * FILE: apps/admin/src/lib/reporterKey.ts
 * PURPOSE: Short label for a stored reporter key.
 *
 * Since 2026-09-22 reporter_token_hash holds a one-way key, `rk1_<64 hex>`
 * (packages/server/supabase/functions/_shared/reporter-token.ts), not the
 * digest the SDK authenticates with. Labels show the hex, not the version
 * prefix; older digests and sentinels such as `cron:library` pass through.
 */
export function shortReporterKey(value: string, length = 8): string {
  return value.replace(/^rk\d+_/, '').slice(0, length)
}
