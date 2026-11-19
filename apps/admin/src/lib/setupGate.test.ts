import { describe, expect, it } from 'vitest'
import { backendFormErrors, consoleConfigBlock, CONSOLE_HOSTING_OPTIONS } from './setupGate'

const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.sig'

describe('consoleConfigBlock', () => {
  it('static and Docker builds bake the values in at build time, with the API under /functions/v1/api', () => {
    const s = consoleConfigBlock('static', { supabaseUrl: 'https://abc.supabase.co/', anonKey: JWT })
    expect(s.code).toContain('VITE_SUPABASE_URL=https://abc.supabase.co \\')
    expect(s.code).toContain('VITE_API_URL=https://abc.supabase.co/functions/v1/api')
    expect(s.code).toContain('VITE_INSTANCE_TYPE=self-hosted')
    expect(s.code).toContain('pnpm --filter "@mushi-mushi/admin..." build')
    expect(s.when).toContain('build time')
    const d = consoleConfigBlock('docker', { supabaseUrl: 'http://localhost', anonKey: JWT })
    expect(d.code).toContain('--build-arg VITE_SUPABASE_URL=http://localhost')
    expect(d.code).toContain('deploy/Dockerfile.admin')
  })

  it('placeholders until values are typed; compose rebuilds from deploy/.env; only the dev server restarts', () => {
    expect(consoleConfigBlock('static').code).toContain('<your-ref>.supabase.co')
    expect(consoleConfigBlock('compose').code).toBe('docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build admin')
    expect(consoleConfigBlock('dev').when).toContain('restart')
    expect(consoleConfigBlock('static').when).not.toContain('restart')
    expect(CONSOLE_HOSTING_OPTIONS.map((o) => o.id)).toEqual(['static', 'docker', 'compose', 'dev'])
  })
})

describe('backendFormErrors', () => {
  it('accepts a Supabase project or a Compose localhost with a JWT or publishable key', () => {
    expect(backendFormErrors({ supabaseUrl: 'https://abcdefghijklmnopqrst.supabase.co', anonKey: JWT })).toEqual({})
    expect(backendFormErrors({ supabaseUrl: 'http://localhost', anonKey: 'sb_publishable_abc' })).toEqual({})
  })
  it('names the field that is wrong', () => {
    expect(backendFormErrors({ supabaseUrl: 'not a url', anonKey: '' })).toMatchObject({ supabaseUrl: expect.any(String), anonKey: 'Paste the anon (public) key.' })
    expect(backendFormErrors({ supabaseUrl: 'http://localhost', anonKey: 'service-role-ish' }).anonKey).toContain('does not look like')
  })
})
