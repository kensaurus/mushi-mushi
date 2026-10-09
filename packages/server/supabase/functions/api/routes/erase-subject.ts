/**
 * FILE: packages/server/supabase/functions/api/routes/erase-subject.ts
 * PURPOSE: POST /v1/sdk/erase-subject — a host app's backend erases one of its
 *          users from a project (account deletion; GDPR Art. 17).
 *
 * AUTH: no API key. The request carries an erase token in X-Mushi-Erase-Token:
 *   an HS256 JWT signed with the project's identity secret (the secret the
 *   host already uses for X-Mushi-User-Token), with purpose "erase-subject"
 *   and a lifetime of at most 5 minutes (_shared/subject-erasure.ts). Only the
 *   host's server holds that secret; SDK identity tokens lack the purpose
 *   claim and are refused. Per-project rate limit: 30 requests / minute.
 *
 * BEHAVIOUR (idempotent):
 *   1. Screenshots of the subject's reports are deleted from storage first —
 *      the report rows are the only record of the keys. Any failure → 502 and
 *      nothing else is touched, so the host can retry.
 *   2. erase_subject() deletes the subject's reports (cascading comments,
 *      notifications, embeddings, fix attempts …) and reporter data in this
 *      project; with erase_identity it also erases the org-level identity
 *      (migration 20261006120000_erase_subject.sql).
 *   An unknown subject is 200 with zero counts.
 *
 * DELETE /v1/sdk/me (rewards.ts) is the end user's own route and keeps their
 * reports (unlinked); this one is for a deleted account and removes them.
 */

import type { Context, Hono } from 'npm:hono@4';
import type { Variables } from '../types.ts';
import { getServiceClient } from '../../_shared/db.ts';
import { log as rootLog } from '../../_shared/logger.ts';
import { loadIdentitySecret, verifyHs256 } from '../../_shared/end-user-identity.ts';
import { getStorageAdapter, getStorageSettings } from '../../_shared/storage.ts';
import {
  checkEraseClaims,
  ERASE_TOKEN_HEADER,
  type EraseClaims,
  parseStoragePath,
  peekProjectId,
} from '../../_shared/subject-erasure.ts';

const log = rootLog.child('erase-subject');

const ERASE_MAX_PER_MINUTE = 30;

type Db = ReturnType<typeof getServiceClient>;

export interface EraseSubjectDeps {
  db: Db;
  nowSecs: () => number;
  loadSecret: (db: Db, projectId: string) => Promise<string | null>;
  verify: (token: string, secret: string) => Promise<EraseClaims | null>;
  deleteObject: (db: Db, projectId: string, storagePath: string) => Promise<void>;
}

export type EraseSubjectResult =
  | {
      status: 200;
      body: { ok: true; data: { erased: Record<string, unknown>; screenshots_deleted: number } };
    }
  | {
      status: 401 | 403 | 429 | 500 | 502;
      body: { ok: false; error: { code: string; message: string } };
    };

function fail(
  status: 401 | 403 | 429 | 500 | 502,
  code: string,
  message: string,
): EraseSubjectResult {
  return { status, body: { ok: false, error: { code, message } } };
}

/** Delete one stored screenshot. Supabase paths go straight to their bucket. */
async function deleteStoredObject(db: Db, projectId: string, storagePath: string): Promise<void> {
  const parsed = parseStoragePath(storagePath);
  if (!parsed) throw new Error('unrecognised storage path');
  if (parsed.provider === 'supabase') {
    const { error } = await db.storage.from(parsed.bucket).remove([parsed.key]);
    if (error) throw new Error(`supabase remove failed: ${error.message}`);
    return;
  }
  // BYO storage: only the project's configured bucket is reachable.
  const settings = await getStorageSettings(projectId);
  const family = (p: string) => (p === 'gcs' ? 'gcs' : 's3');
  if (
    !settings ||
    settings.bucket !== parsed.bucket ||
    family(settings.provider) !== family(parsed.provider)
  ) {
    throw new Error(`no configured adapter for ${parsed.provider} bucket`);
  }
  await (await getStorageAdapter(projectId)).delete(parsed.key);
}

/** @internal Exported for tests (src/__tests__/erase-subject-route.test.ts). */
export async function eraseSubject(
  token: string | null | undefined,
  deps: EraseSubjectDeps,
): Promise<EraseSubjectResult> {
  const unauthorized = fail(
    401,
    'ERASE_TOKEN_INVALID',
    `Send a signed erase token in ${ERASE_TOKEN_HEADER}.`,
  );
  if (!token)
    return fail(401, 'ERASE_TOKEN_REQUIRED', `Send a signed erase token in ${ERASE_TOKEN_HEADER}.`);

  const projectId = peekProjectId(token);
  if (!projectId) return unauthorized;

  const { db } = deps;
  const { error: rateErr } = await db.rpc('scoped_rate_limit_claim', {
    p_user_id: projectId,
    p_scope: 'sdk_erase_subject',
    p_max_per_window: ERASE_MAX_PER_MINUTE,
    p_window: '1 minute',
  });
  if (rateErr) {
    // Only `rate_limit_exceeded` (P0001) is a breach. Any other error is a
    // fault in the claim itself: fail closed, but say so and log it instead
    // of reporting throttling.
    if ((rateErr.message ?? '').includes('rate_limit_exceeded')) {
      return fail(429, 'RATE_LIMITED', 'Too many erase requests. Retry in 60 seconds.');
    }
    log.error('erase_rate_limit_failed', { projectId, error: rateErr.message });
    return fail(500, 'ERASE_FAILED', 'Could not check the erase rate limit. Retry shortly.');
  }

  // Same answer for "no secret configured" and "bad signature".
  const secret = await deps.loadSecret(db, projectId);
  if (!secret) return unauthorized;
  const claims = await deps.verify(token, secret);
  if (!claims) return unauthorized;

  const check = checkEraseClaims(claims, projectId, deps.nowSecs());
  if (!check.ok) return fail(check.status, check.code, check.message);

  const { data: targets, error: targetsErr } = await db.rpc('erase_subject_targets', {
    p_project_id: projectId,
    p_external_user_id: check.sub,
  });
  if (targetsErr) {
    log.error('erase_subject_targets_failed', { projectId, error: targetsErr.message });
    return fail(500, 'ERASE_FAILED', "Could not list the subject's stored files.");
  }

  const paths = [
    ...new Set(
      ((targets ?? []) as { screenshot_path: string | null }[])
        .map((t) => t.screenshot_path)
        .filter((p): p is string => typeof p === 'string' && p.length > 0),
    ),
  ];
  let failed = 0;
  for (const path of paths) {
    try {
      await deps.deleteObject(db, projectId, path);
    } catch (err) {
      failed++;
      log.warn('erase_subject_object_delete_failed', { projectId, err: String(err) });
    }
  }
  if (failed > 0) {
    return fail(
      502,
      'STORAGE_DELETE_FAILED',
      `${failed} of ${paths.length} stored files could not be deleted; nothing else was erased. Retry.`,
    );
  }

  const { data: erased, error } = await db.rpc('erase_subject', {
    p_project_id: projectId,
    p_external_user_id: check.sub,
    p_erase_identity: check.eraseIdentity,
  });
  if (error) {
    log.error('erase_subject_failed', { projectId, error: error.message });
    return fail(500, 'ERASE_FAILED', 'Erasure failed; nothing was committed. Retry.');
  }

  log.info('erase_subject_done', {
    projectId,
    screenshots: paths.length,
    eraseIdentity: check.eraseIdentity,
  });
  return {
    status: 200,
    body: {
      ok: true,
      data: {
        erased: (erased ?? {}) as Record<string, unknown>,
        screenshots_deleted: paths.length,
      },
    },
  };
}

export function registerEraseSubjectRoutes(app: Hono<{ Variables: Variables }>): void {
  app.post('/v1/sdk/erase-subject', async (c: Context) => {
    const result = await eraseSubject(c.req.header(ERASE_TOKEN_HEADER), {
      db: getServiceClient(),
      nowSecs: () => Math.floor(Date.now() / 1000),
      loadSecret: loadIdentitySecret,
      verify: (token, secret) => verifyHs256<EraseClaims>(token, secret),
      deleteObject: deleteStoredObject,
    });
    return c.json(result.body, result.status);
  });
}
