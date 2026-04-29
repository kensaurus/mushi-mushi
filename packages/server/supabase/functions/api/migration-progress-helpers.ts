/**
 * Pure helpers for /v1/admin/migrations/progress payload handling.
 *
 * Extracted from `routes/migration-progress.ts` so they can be unit-tested
 * from vitest (Node) without pulling in the Deno-only Hono import surface.
 * The route module re-exports these by reference; do NOT duplicate the
 * normalisation logic in the route file.
 */

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,79}$/;

/**
 * Sorted union of every migration guide slug the docs ship.
 *
 * Mirrors `apps/docs/content/migrations/_catalog.ts` (CATALOG entries).
 * `scripts/check-migration-catalog-sync.mjs` enforces equality between
 * docs catalog, CLI catalog, and this list — adding a guide in any of the
 * three without updating the others fails the build before publish.
 */
export const KNOWN_GUIDE_SLUGS: readonly string[] = [
  'bugherd-to-mushi',
  'capacitor-to-react-native',
  'cordova-to-capacitor',
  'cordova-to-react-native',
  'cra-to-vite',
  'instabug-to-mushi',
  'logrocket-feedback-to-mushi',
  'mushi-sdk-upgrade',
  'native-to-hybrid',
  'nextjs-pages-to-app-router',
  'pendo-feedback-to-mushi',
  'react-native-cli-to-expo',
  'shake-to-mushi',
  'spa-to-ssr',
  'vue-2-to-vue-3',
] as const;

const KNOWN_SLUG_SET = new Set<string>(KNOWN_GUIDE_SLUGS);

export const PROGRESS_SOURCES = ['docs', 'admin', 'cli'] as const;
export type ProgressSource = (typeof PROGRESS_SOURCES)[number];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

export function isProgressSource(value: unknown): value is ProgressSource {
  return typeof value === 'string' && (PROGRESS_SOURCES as readonly string[]).includes(value);
}

export function isKnownGuideSlug(slug: unknown): slug is string {
  return typeof slug === 'string' && SLUG_RE.test(slug) && KNOWN_SLUG_SET.has(slug);
}

/**
 * Normalise a step-id array from a remote payload:
 *   - drop non-strings, empty strings, oversized strings (>200 chars)
 *   - trim whitespace
 *   - dedupe
 *   - sort alphabetically (stable across writes from different clients)
 */
export function normalizeStepIds(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  for (const v of input) {
    if (typeof v !== 'string') continue;
    const trimmed = v.trim();
    if (!trimmed || trimmed.length > 200) continue;
    seen.add(trimmed);
  }
  return Array.from(seen).sort();
}

export interface ProgressUpsertInput {
  project_id?: unknown;
  completed_step_ids?: unknown;
  required_step_count?: unknown;
  completed_required_count?: unknown;
  source?: unknown;
  client_updated_at?: unknown;
}

export interface NormalizedProgress {
  projectId: string | null;
  completedStepIds: string[];
  requiredStepCount: number | null;
  completedRequiredCount: number;
  source: ProgressSource;
  clientUpdatedAt: string | null;
}

export type NormalizationResult =
  | { ok: true; value: NormalizedProgress }
  | { ok: false; code: 'INVALID_PROJECT_ID' | 'INVALID_REQUIRED_COUNT' | 'INVALID_COMPLETED_COUNT' | 'COUNT_MISMATCH' | 'INVALID_TIMESTAMP'; message: string };

/**
 * Coerce a PUT body into the shape we write to the database.
 * Returns either a normalised payload or a structured error code that the
 * route handler maps to a 400 response with the same code.
 */
export function normalizeProgressUpsert(body: ProgressUpsertInput): NormalizationResult {
  let projectId: string | null = null;
  if (body.project_id !== undefined && body.project_id !== null) {
    if (!isUuid(body.project_id)) {
      return { ok: false, code: 'INVALID_PROJECT_ID', message: 'project_id must be a UUID or null' };
    }
    projectId = body.project_id;
  }

  const completedStepIds = normalizeStepIds(body.completed_step_ids);

  let requiredStepCount: number | null = null;
  if (body.required_step_count !== undefined && body.required_step_count !== null) {
    const n = Number(body.required_step_count);
    if (!Number.isInteger(n) || n < 0 || n > 1000) {
      return {
        ok: false,
        code: 'INVALID_REQUIRED_COUNT',
        message: 'required_step_count must be a non-negative integer ≤ 1000',
      };
    }
    requiredStepCount = n;
  }

  let completedRequiredCount: number;
  if (body.completed_required_count !== undefined) {
    const n = Number(body.completed_required_count);
    if (!Number.isInteger(n) || n < 0 || n > 1000) {
      return {
        ok: false,
        code: 'INVALID_COMPLETED_COUNT',
        message: 'completed_required_count must be a non-negative integer ≤ 1000',
      };
    }
    completedRequiredCount = n;
  } else {
    completedRequiredCount =
      requiredStepCount !== null
        ? Math.min(completedStepIds.length, requiredStepCount)
        : completedStepIds.length;
  }

  if (requiredStepCount !== null && completedRequiredCount > requiredStepCount) {
    return {
      ok: false,
      code: 'COUNT_MISMATCH',
      message: 'completed_required_count cannot exceed required_step_count',
    };
  }

  const source: ProgressSource = isProgressSource(body.source) ? body.source : 'docs';

  let clientUpdatedAt: string | null = null;
  if (typeof body.client_updated_at === 'string' && body.client_updated_at) {
    const dt = new Date(body.client_updated_at);
    if (Number.isNaN(dt.getTime())) {
      return {
        ok: false,
        code: 'INVALID_TIMESTAMP',
        message: 'client_updated_at must be an ISO timestamp',
      };
    }
    clientUpdatedAt = dt.toISOString();
  }

  return {
    ok: true,
    value: {
      projectId,
      completedStepIds,
      requiredStepCount,
      completedRequiredCount,
      source,
      clientUpdatedAt,
    },
  };
}
