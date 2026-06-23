/**
 * FILE: reporter-token.ts
 * PURPOSE: Stable, project-scoped anonymous reporter identity for the My Reports inbox.
 *
 * OVERVIEW:
 * - Each Mushi project gets its own localStorage key so multi-project hosts on the
 *   same origin (e.g. kensaur.us/glot-it vs /other-app) never share a token.
 * - One-time migration copies the legacy global `mushi_reporter_token` into the
 *   first projectId requested, preserving existing inbox history for that project.
 *
 * USAGE:
 * - `getReporterToken(projectId)` from web/RN/Capacitor SDK before submit or inbox calls.
 */

const LEGACY_STORAGE_KEY = 'mushi_reporter_token';

function storageKey(projectId: string): string {
  return `mushi:reporter-token:${projectId}`;
}

function generateToken(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `mushi_${crypto.randomUUID()}`;
  }

  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }

  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `mushi_${hex}`;
}

function readStoredToken(key: string): string | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const existing = localStorage.getItem(key);
    return existing && existing.length > 0 ? existing : null;
  } catch {
    return null;
  }
}

function writeStoredToken(key: string, token: string): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(key, token);
  } catch {
    // localStorage full or unavailable — token is ephemeral for this session
  }
}

/**
 * Return a stable reporter token scoped to `projectId`.
 * Legacy callers without a projectId still work but should migrate — the global
 * key is read once and re-homed into the namespaced slot.
 */
export function getReporterToken(projectId?: string): string {
  if (!projectId) {
    const legacy = readStoredToken(LEGACY_STORAGE_KEY);
    if (legacy) return legacy;
    const token = generateToken();
    writeStoredToken(LEGACY_STORAGE_KEY, token);
    return token;
  }

  const key = storageKey(projectId);
  const scoped = readStoredToken(key);
  if (scoped) return scoped;

  // Migrate legacy global token into this project on first touch.
  const legacy = readStoredToken(LEGACY_STORAGE_KEY);
  const token = legacy ?? generateToken();
  writeStoredToken(key, token);
  return token;
}

/** Test-only helper — clears both legacy and scoped keys. */
export function clearReporterTokensForTests(projectId?: string): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    if (projectId) localStorage.removeItem(storageKey(projectId));
  } catch {
    /* noop */
  }
}
