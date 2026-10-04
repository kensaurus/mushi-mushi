/**
 * FILE: packages/server/supabase/functions/_shared/report-list-filters.ts
 * PURPOSE: The filters GET /v1/admin/reports applies and the windows every
 *          report count uses, in one place, so a count and the list it opens
 *          can never disagree (2026-10-04 console audit, group B).
 *
 * Pure: no Deno or database imports, so the vitest suite can exercise it.
 */

/** Report severities the DB CHECK allows (phase0_initial_schema.sql). */
export const REPORT_SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;

/**
 * GET /v1/admin/reports `sort` values → DB column. Severity is a text column,
 * so ordering it directly is alphabetical (medium, low, high, critical);
 * `severity_rank` is the generated 4..1 column from migration
 * 20261004120000_reports_severity_rank.sql.
 */
export const REPORT_SORT_COLUMNS: Record<string, string> = {
  created_at: 'created_at',
  severity: 'severity_rank',
  confidence: 'confidence',
  status: 'status',
  component: 'component',
};

/** Stored statuses the console's "New" bucket covers (list filter + chip count). */
export const NEW_BUCKET_STATUSES = ['new', 'queued', 'pending', 'submitted'] as const;

/**
 * Platform filter → `environment->>platform` patterns. Values are what the
 * SDKs really send: React Native writes Platform.OS (`ios` / `android`), the
 * web SDK writes navigator.platform (`iPhone`, `MacIntel`, `Win32`,
 * `Linux armv8l` on Android Chrome, …), Sentry imports write `javascript`.
 * Matching is case-insensitive.
 */
const PLATFORM_PATTERNS: Record<string, readonly string[]> = {
  ios: ['ios', 'iphone%', 'ipad%', 'ipod%'],
  android: ['android%', 'linux arm%', 'linux aarch64%'],
  macos: ['mac%', 'darwin%'],
  windows: ['win%'],
  linux: ['linux x86%', 'linux i686%'],
  web: ['web', 'javascript'],
};

export const REPORT_LIST_PLATFORMS = Object.keys(PLATFORM_PATTERNS);

/**
 * SDK packages that stamp `reports.sdk_package`. The React, Vue, Svelte,
 * Angular and Capacitor wrappers all report through `@mushi-mushi/web`.
 */
export const REPORT_LIST_SDK_PACKAGES = ['@mushi-mushi/web', '@mushi-mushi/react-native'] as const;

/**
 * PostgREST `or=` body for one Platform choice, or null for an unknown value.
 * "Web" also matches reports stamped by the web SDK, whatever OS they ran on.
 */
export function platformOrClause(platform: string): string | null {
  const patterns = PLATFORM_PATTERNS[platform];
  if (!patterns) return null;
  const clauses = patterns.map((p) => `environment->>platform.ilike."${p}"`);
  if (platform === 'web') clauses.push('sdk_package.eq.@mushi-mushi/web');
  return clauses.join(',');
}

/**
 * Several `or` groups ANDed together as one `or=` value. Two separate
 * `.or()` calls would send two `or` params; nesting them in `and(...)` is the
 * documented PostgREST form.
 */
export function combineOrGroups(groups: readonly string[]): string | null {
  const present = groups.filter((g) => g.length > 0);
  if (present.length === 0) return null;
  if (present.length === 1) return present[0];
  return `and(${present.map((g) => `or(${g})`).join(',')})`;
}

/** `days` query param → 1..90, or null when absent or invalid. */
export function parseWindowDays(raw: string | null | undefined): number | null {
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 90) return null;
  return n;
}

/**
 * Start of an N-day report window: UTC midnight of the day N-1 days ago, so
 * "last 14 days" means today plus the 13 days before it. Every 14-day report
 * count (dashboard, inbox, /reports stats, severity KPIs) and the list's
 * `days` filter use this, so a tile and the list it opens agree.
 */
export function reportWindowStartIso(days: number, now: Date = new Date()): string {
  const since = new Date(now.getTime());
  since.setUTCDate(since.getUTCDate() - (days - 1));
  since.setUTCHours(0, 0, 0, 0);
  return since.toISOString();
}

/**
 * PATCH /v1/admin/reports/:id `severity`: a known severity, or null to clear
 * it. The console's "Unset" option sends '' — the DB CHECK rejects '', so it
 * used to fail as a 500 on every attempt.
 */
export function parseSeverityUpdate(
  raw: unknown,
): { ok: true; value: string | null } | { ok: false } {
  if (raw === null || raw === '') return { ok: true, value: null };
  if (typeof raw === 'string' && (REPORT_SEVERITIES as readonly string[]).includes(raw)) {
    return { ok: true, value: raw };
  }
  return { ok: false };
}
