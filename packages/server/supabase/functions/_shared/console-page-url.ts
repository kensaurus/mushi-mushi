/**
 * FILE: packages/server/supabase/functions/_shared/console-page-url.ts
 * PURPOSE: The console page the server sends a person to (CLI sign-in
 *          approval, MCP OAuth consent). Mushi Cloud serves the console at
 *          <first MUSHI_ADMIN_ORIGIN_ALLOWLIST origin>/mushi-mushi/admin. A
 *          self-host serves it wherever ADMIN_BASE_URL says (Compose: the
 *          public URL at /), so `mushi login` against a self-hosted API opened
 *          Mushi Mushi Cloud's console before this, where the code means
 *          nothing.
 *
 * Self-hosted with ADMIN_BASE_URL set: <ADMIN_BASE_URL>/<page>.
 * Otherwise (Cloud, or a self-host without it): the old rule, unchanged.
 */

import { instanceMode, type InstanceMode } from './instance-mode.ts'

export function consolePageUrlFrom(
  input: { mode: InstanceMode; adminBaseUrl?: string | null; originAllowlist?: string | null },
  page: string,
): string {
  const path = page.replace(/^\/+/, '')
  const base = (input.adminBaseUrl ?? '').trim().replace(/\/+$/, '')
  if (input.mode === 'self-hosted' && /^https?:\/\//.test(base)) return `${base}/${path}`
  const origin = (input.originAllowlist ?? '').split(',')[0]?.trim() || 'https://kensaur.us'
  return `${origin}/mushi-mushi/admin/${path}`
}

export function consolePageUrl(page: string): string {
  return consolePageUrlFrom(
    {
      mode: instanceMode(),
      adminBaseUrl: Deno.env.get('ADMIN_BASE_URL'),
      originAllowlist: Deno.env.get('MUSHI_ADMIN_ORIGIN_ALLOWLIST'),
    },
    page,
  )
}
