/**
 * FILE: packages/cli/src/spend-down.ts
 * PURPOSE: `mushi keys spend-down` (ADR 0028): turn CLI flags into the PATCH
 *          body for /v1/admin/byok/keys/:keyId/spend-down, and print the
 *          status from GET /v1/admin/byok/spend-down one line per key.
 */

export interface SpendDownFlags {
  on?: boolean;
  off?: boolean;
  expires?: string;
  model?: string;
  perDay?: string;
  windowDays?: string;
}

export type SpendDownBody = {
  enabled?: boolean;
  creditsExpireAt?: string;
  model?: string | null;
  dailyLimit?: number;
  windowDays?: number;
};

function wholeNumber(raw: string, flag: string, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${flag} must be a whole number from ${min} to ${max}`);
  return n;
}

/** Throws with a flag-level message on bad input; returns null when no flag was given. */
export function spendDownBody(flags: SpendDownFlags): SpendDownBody | null {
  if (flags.on && flags.off) throw new Error('Pass --on or --off, not both');
  const body: SpendDownBody = {};
  if (flags.on) body.enabled = true;
  if (flags.off) body.enabled = false;
  if (flags.expires !== undefined) body.creditsExpireAt = flags.expires;
  if (flags.model !== undefined) body.model = flags.model === '' ? null : flags.model;
  if (flags.perDay !== undefined) body.dailyLimit = wholeNumber(flags.perDay, '--per-day', 1, 200);
  if (flags.windowDays !== undefined) body.windowDays = wholeNumber(flags.windowDays, '--window-days', 1, 90);
  return Object.keys(body).length > 0 ? body : null;
}

export interface SpendDownStatusKey {
  id: string;
  label: string | null;
  keyHint: string | null;
  scope: string;
  enabled: boolean;
  creditsExpireAt: string | null;
  model: string | null;
  dailyLimit: number;
  state: string;
  startsAt: string | null;
  dispatchedToday: number;
  projects: Array<{ id: string; name: string }>;
}

export function spendDownStatusLine(k: SpendDownStatusKey): string {
  const name = `${k.label ?? '(no label)'} ${k.keyHint ?? ''}`.trim();
  const expires = k.creditsExpireAt ? k.creditsExpireAt.slice(0, 10) : 'not set';
  const model = k.model ?? 'app default';
  const apps = k.projects.length > 0 ? k.projects.map((p) => p.name).join(', ') : 'none';
  return `${name} [${k.scope}] ${k.state} · ${k.dispatchedToday}/${k.dailyLimit} today · credits expire ${expires} · model ${model} · pays for ${apps} — ${k.id}`;
}
