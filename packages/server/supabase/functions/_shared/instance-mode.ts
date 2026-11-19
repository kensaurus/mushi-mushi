/**
 * FILE: packages/server/supabase/functions/_shared/instance-mode.ts
 * PURPOSE: Which kind of Mushi Mushi backend this is — Mushi Cloud (hosted)
 *          or a self-hosted install — so the console can say so in its
 *          sidebar instead of guessing from its own build-time env.
 *
 * Order:
 *   1. `MUSHI_INSTANCE_MODE` = `hosted` | `self-hosted` (explicit; set it when
 *      a self-host runs behind a proxy whose URL looks like Cloud, or when
 *      Cloud moves project).
 *   2. `SUPABASE_URL` points at the Mushi Cloud project → `hosted`.
 *   3. Anything else → `self-hosted`.
 *
 * Pure apart from the env read; `instanceModeFrom` is the testable core.
 */

export type InstanceMode = 'hosted' | 'self-hosted'

/** Mushi Cloud's Supabase project ref (apps/admin/vite.config.ts uses the same). */
export const CLOUD_PROJECT_REF = 'dxptnwrhwsqckaftyymj'

export function instanceModeFrom(explicit: string | undefined | null, supabaseUrl: string | undefined | null): InstanceMode {
  const e = (explicit ?? '').trim().toLowerCase()
  if (e === 'hosted' || e === 'cloud') return 'hosted'
  if (e === 'self-hosted' || e === 'selfhosted' || e === 'self_hosted') return 'self-hosted'
  const url = (supabaseUrl ?? '').trim().toLowerCase()
  if (url.includes(`${CLOUD_PROJECT_REF}.supabase.co`)) return 'hosted'
  return 'self-hosted'
}

export function instanceMode(): InstanceMode {
  return instanceModeFrom(Deno.env.get('MUSHI_INSTANCE_MODE'), Deno.env.get('SUPABASE_URL'))
}
