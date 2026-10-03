/**
 * supabase/config.toml: only the declared, non-secret login settings are
 * read for the shared-auth rule. Secret values are never kept.
 */
import { describe, expect, it } from 'vitest'
import { parseSupabaseAuthConfig, parseTomlSubset } from '../../supabase/functions/_shared/supabase-config-toml.ts'

const TOML = `
project_id = "glot"

[auth]
enabled = true
site_url = "https://glot.it" # the main site
additional_redirect_urls = [
  "https://glot.it/**",
  "glotit://**",
]

[auth.email]
enable_signup = true
enable_confirmations = false

[auth.mfa.totp]
enroll_enabled = true

[auth.external.google]
enabled = true
client_id = "abc"
secret = "env(GOOGLE_SECRET)"

[auth.external.apple]
enabled = false
`

describe('parseSupabaseAuthConfig', () => {
  it('reads site url, redirect list, providers, confirmation and MFA', () => {
    expect(parseSupabaseAuthConfig(TOML)).toEqual({
      siteUrl: 'https://glot.it',
      redirectUrls: ['https://glot.it/**', 'glotit://**'],
      providers: ['email', 'google'],
      emailConfirm: false,
      mfa: true,
    })
  })

  it('keeps no secret value and returns null without an [auth] table', () => {
    expect(JSON.stringify(parseSupabaseAuthConfig(TOML))).not.toContain('GOOGLE_SECRET')
    expect(parseSupabaseAuthConfig('[db]\nport = 54322\n')).toBeNull()
  })

  it('does not treat a # inside a string as a comment', () => {
    expect(parseTomlSubset('[auth]\nsite_url = "https://x.test/#/home" # note\n').get('auth')?.get('site_url')).toBe('https://x.test/#/home')
  })
})
