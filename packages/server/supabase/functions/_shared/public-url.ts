/**
 * FILE: _shared/public-url.ts
 * PURPOSE: Turn a URL Supabase built from the functions' own SUPABASE_URL into
 *          one a browser can open.
 *
 * Self-hosted, SUPABASE_URL is the internal gateway (http://api-gw:8000 in
 * deploy/selfhost, http://caddy:8000 in deploy/docker-compose.yml), so signed
 * Storage links (screenshots, thumbnails, voice notes, captures) pointed at a
 * host only the containers can reach. SUPABASE_PUBLIC_URL is the address people
 * use; both self-host setups set it. On the hosted platform it is unset (or the
 * same as SUPABASE_URL), so URLs pass through unchanged.
 */

function trimSlash(s: string): string {
  return s.replace(/\/+$/, '')
}

/**
 * Rewrite `url` to the public origin when it starts with the internal
 * SUPABASE_URL. Anything else (another host, a relative path, null) is
 * returned as is.
 */
export function toPublicSupabaseUrl<T extends string | null | undefined>(
  url: T,
  env: { internal?: string; public?: string } = {
    internal: typeof Deno !== 'undefined' ? Deno.env.get('SUPABASE_URL') : undefined,
    public: typeof Deno !== 'undefined' ? Deno.env.get('SUPABASE_PUBLIC_URL') : undefined,
  },
): T {
  if (!url) return url
  const internal = trimSlash((env.internal ?? '').trim())
  const pub = trimSlash((env.public ?? '').trim())
  if (!internal || !pub || internal === pub) return url
  if (url === internal || url.startsWith(`${internal}/`) || url.startsWith(`${internal}?`)) {
    return (pub + url.slice(internal.length)) as T
  }
  return url
}
