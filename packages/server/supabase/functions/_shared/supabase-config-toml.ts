/**
 * FILE: packages/server/supabase/functions/_shared/supabase-config-toml.ts
 * PURPOSE: Read the login settings a repo DECLARES in `supabase/config.toml`
 *          (Plan 019 §3b shared-auth rule). This is the file `supabase config
 *          push` sends to the live project; settings changed in the dashboard
 *          are not in it, so every finding built on it says "declared in".
 *
 *   Only the [auth] tables are read, and only non-secret keys: site_url,
 *   additional_redirect_urls, [auth.email] enable_confirmations,
 *   [auth.mfa.totp] enroll_enabled, and which [auth.external.*] providers are
 *   enabled. Secret values (client secrets, SMTP passwords) are never kept.
 *
 * A small TOML subset: tables, `key = value` with strings, booleans, numbers
 * and (multi-line) string arrays. Anything else is skipped, never guessed.
 */

export interface DeclaredAuthSettings {
  siteUrl?: string
  redirectUrls?: string[]
  providers?: string[]
  emailConfirm?: boolean
  mfa?: boolean
}

type Value = string | boolean | number | string[]

function parseValue(raw: string): Value | undefined {
  const v = raw.trim()
  if (v === 'true') return true
  if (v === 'false') return false
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v)
  const str = /^"((?:[^"\\]|\\.)*)"$/.exec(v) ?? /^'([^']*)'$/.exec(v)
  if (str) return str[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\')
  if (v.startsWith('[') && v.endsWith(']')) {
    const items = [...v.slice(1, -1).matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'/g)].map((m) => m[1] ?? m[2])
    return items
  }
  return undefined
}

function stripComment(line: string): string {
  let inStr: string | null = null
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inStr) {
      if (ch === '\\' && inStr === '"') i++
      else if (ch === inStr) inStr = null
    } else if (ch === '"' || ch === "'") inStr = ch
    else if (ch === '#') return line.slice(0, i)
  }
  return line
}

/** table path → key → value, for the TOML subset above. */
export function parseTomlSubset(text: string): Map<string, Map<string, Value>> {
  const tables = new Map<string, Map<string, Value>>([['', new Map()]])
  let current = ''
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = stripComment(lines[i]).trim()
    if (!line) continue
    const table = /^\[([A-Za-z0-9_.-]+)\]$/.exec(line)
    if (table) {
      current = table[1]
      if (!tables.has(current)) tables.set(current, new Map())
      continue
    }
    const kv = /^([A-Za-z0-9_-]+)\s*=\s*(.*)$/.exec(line)
    if (!kv) continue
    let raw = kv[2]
    // A multi-line array: keep reading until the closing bracket.
    if (raw.trim().startsWith('[') && !raw.includes(']')) {
      while (i + 1 < lines.length && !raw.includes(']')) raw += ` ${stripComment(lines[++i]).trim()}`
    }
    const value = parseValue(raw)
    if (value !== undefined) tables.get(current)!.set(kv[1], value)
  }
  return tables
}

/** The declared login settings, or null when the file has no [auth] table. */
export function parseSupabaseAuthConfig(text: string): DeclaredAuthSettings | null {
  const t = parseTomlSubset(text)
  const auth = t.get('auth')
  if (!auth) return null
  const out: DeclaredAuthSettings = {}
  const site = auth.get('site_url')
  if (typeof site === 'string') out.siteUrl = site
  const redirects = auth.get('additional_redirect_urls')
  if (Array.isArray(redirects)) out.redirectUrls = redirects.slice(0, 200)
  const confirm = t.get('auth.email')?.get('enable_confirmations')
  if (typeof confirm === 'boolean') out.emailConfirm = confirm
  const totp = t.get('auth.mfa.totp')?.get('enroll_enabled')
  if (typeof totp === 'boolean') out.mfa = totp
  const providers: string[] = []
  const emailSignup = t.get('auth.email')?.get('enable_signup')
  if (emailSignup !== false) providers.push('email')
  for (const [path, table] of t) {
    const m = /^auth\.external\.([a-z0-9_]+)$/.exec(path)
    if (m && table.get('enabled') === true) providers.push(m[1])
  }
  out.providers = providers.sort()
  return out
}
