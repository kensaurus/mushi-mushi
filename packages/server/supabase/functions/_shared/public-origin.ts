/**
 * FILE: packages/server/supabase/functions/_shared/public-origin.ts
 * PURPOSE: MUSHI_PUBLIC_ORIGIN — the origin (scheme + host, no path) of the
 *          public Mushi site. The marketing site, console, docs and hosted
 *          MCP live under `/mushi-mushi/` on it. Unset or invalid, the hosted
 *          default, so the hosted service is unchanged. Same rule as the CLI
 *          (packages/cli/src/endpoint.ts) and the MCP package (branding.ts).
 */

export const DEFAULT_PUBLIC_ORIGIN = 'https://kensaur.us'

/** Pure: reduce a configured value to an http(s) origin, or the default. */
export function publicOriginFrom(raw: string | null | undefined): string {
  const v = (raw ?? '').trim()
  if (v) {
    try {
      const u = new URL(v)
      if (u.protocol === 'https:' || u.protocol === 'http:') return u.origin
    } catch {
      // not a URL — fall back to the default
    }
  }
  return DEFAULT_PUBLIC_ORIGIN
}

export function publicOrigin(): string {
  return publicOriginFrom(typeof Deno !== 'undefined' ? Deno.env.get('MUSHI_PUBLIC_ORIGIN') : undefined)
}
