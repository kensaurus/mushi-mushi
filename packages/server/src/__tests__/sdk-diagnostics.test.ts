/**
 * `_shared/sdk-diagnostics.ts` — the pure half of the SDK CI-secret
 * diagnostic, extracted from api/routes/project-ci-secrets.ts (gap #35).
 */
import { describe, expect, it } from 'vitest'
import {
  buildCiVars,
  buildGuidedFallback,
  inferStack,
  lastHeartbeatAt,
  missingCiVars,
  nativeEverSeen,
  requiredCiVarNames,
  sdkDiagnosticVerdict,
} from '../../supabase/functions/_shared/sdk-diagnostics.ts'

describe('required CI vars per stack', () => {
  it('names the three vars with the stack prefix, the key as the only secret', () => {
    expect(requiredCiVarNames('nextjs')).toEqual([
      { name: 'NEXT_PUBLIC_MUSHI_PROJECT_ID', ghKind: 'variable' },
      { name: 'NEXT_PUBLIC_MUSHI_API_KEY', ghKind: 'secret' },
      { name: 'NEXT_PUBLIC_MUSHI_API_ENDPOINT', ghKind: 'variable' },
    ])
    expect(requiredCiVarNames('expo').map((v) => v.name)).toEqual([
      'EXPO_PUBLIC_MUSHI_PROJECT_ID',
      'EXPO_PUBLIC_MUSHI_API_KEY',
      'EXPO_PUBLIC_MUSHI_API_ENDPOINT',
    ])
    expect(requiredCiVarNames('vite').map((v) => v.name)).toEqual([
      'VITE_MUSHI_PROJECT_ID',
      'VITE_MUSHI_API_KEY',
      'VITE_MUSHI_API_ENDPOINT',
    ])
  })

  it('puts the minted key, project id and endpoint in the right slots', () => {
    const vars = buildCiVars({ stack: 'vite', projectId: 'p1', endpoint: 'https://e', mintedKey: 'k1' })
    expect(Object.fromEntries(vars.map((v) => [v.name, v.value]))).toEqual({
      VITE_MUSHI_PROJECT_ID: 'p1',
      VITE_MUSHI_API_KEY: 'k1',
      VITE_MUSHI_API_ENDPOINT: 'https://e',
    })
  })

  it('infers the stack from known slugs and defaults to Next.js', () => {
    expect(inferStack('yen-yen')).toBe('expo')
    expect(inferStack('Mushi-Mushi')).toBe('vite')
    expect(inferStack('glot-it')).toBe('nextjs')
    expect(inferStack(null)).toBe('nextjs')
  })
})

describe('guided fallback', () => {
  it('never prints the key and maps variables to their values', () => {
    const out = buildGuidedFallback({
      owner: 'o',
      repo: 'r',
      ciVarTemplates: requiredCiVarNames('nextjs'),
      projectId: 'pid',
      endpoint: 'https://api',
    })
    expect(out.commands).toEqual([
      'gh variable set NEXT_PUBLIC_MUSHI_PROJECT_ID --body "pid" --repo o/r',
      'gh secret set NEXT_PUBLIC_MUSHI_API_KEY --body "<your-mushi-project-api-key>" --repo o/r',
      'gh variable set NEXT_PUBLIC_MUSHI_API_ENDPOINT --body "https://api" --repo o/r',
    ])
    expect(out.envBlock).toContain('NEXT_PUBLIC_MUSHI_API_KEY: ${{ secrets.NEXT_PUBLIC_MUSHI_API_KEY }}')
    expect(out.envBlock).toContain('NEXT_PUBLIC_MUSHI_PROJECT_ID: ${{ vars.NEXT_PUBLIC_MUSHI_PROJECT_ID }}')
  })
})

describe('heartbeats', () => {
  const web = { last_seen_at: '2026-10-01T00:00:00Z', last_seen_origin: 'https://app.example', last_seen_user_agent: 'Mozilla/5.0 Chrome' }
  it('detects native origins and user agents', () => {
    expect(nativeEverSeen([web])).toBe(false)
    expect(nativeEverSeen([web, { last_seen_at: null, last_seen_origin: 'capacitor://localhost', last_seen_user_agent: null }])).toBe(true)
    expect(nativeEverSeen([{ last_seen_at: null, last_seen_origin: null, last_seen_user_agent: 'okhttp/4.12' }])).toBe(true)
    expect(nativeEverSeen([{ last_seen_at: null, last_seen_origin: null, last_seen_user_agent: 'MyApp CFNetwork/1490' }])).toBe(true)
  })
  it('takes the newest heartbeat whatever the row order', () => {
    expect(lastHeartbeatAt([
      { ...web, last_seen_at: '2026-09-01T00:00:00Z' },
      { ...web, last_seen_at: null },
      { ...web, last_seen_at: '2026-10-02T00:00:00Z' },
    ])).toBe('2026-10-02T00:00:00Z')
    expect(lastHeartbeatAt([])).toBeNull()
  })
})

describe('missingCiVars', () => {
  it('is null when CI could not be read, else the absent names', () => {
    const req = requiredCiVarNames('nextjs')
    expect(missingCiVars(req, null)).toBeNull()
    expect(missingCiVars(req, ['NEXT_PUBLIC_MUSHI_PROJECT_ID'])).toEqual(['NEXT_PUBLIC_MUSHI_API_KEY', 'NEXT_PUBLIC_MUSHI_API_ENDPOINT'])
    expect(missingCiVars(req, req.map((v) => v.name))).toEqual([])
  })
})

describe('sdkDiagnosticVerdict', () => {
  const base = { bannerEnabled: true, launcherMode: 'banner', missingVars: [] as string[] | null, nativeEverSeen: true, lastSeenAt: '2026-10-01T00:00:00Z' }
  it('reports a disabled launcher before anything else', () => {
    expect(sdkDiagnosticVerdict({ ...base, bannerEnabled: false }).status).toBe('banner-disabled')
    expect(sdkDiagnosticVerdict({ ...base, launcherMode: 'hidden', missingVars: ['X'] }).status).toBe('banner-disabled')
  })
  it('names missing CI vars', () => {
    const v = sdkDiagnosticVerdict({ ...base, missingVars: ['NEXT_PUBLIC_MUSHI_API_KEY'] })
    expect(v.status).toBe('ci-secret-missing')
    expect(v.recommendedFix).toContain('NEXT_PUBLIC_MUSHI_API_KEY')
  })
  it('flags web-only heartbeats as native-never-seen', () => {
    expect(sdkDiagnosticVerdict({ ...base, nativeEverSeen: false }).status).toBe('native-never-seen')
  })
  it('is healthy only with CI read and a heartbeat', () => {
    expect(sdkDiagnosticVerdict(base).status).toBe('healthy')
  })
  it('treats no heartbeat at all as a missing secret', () => {
    expect(sdkDiagnosticVerdict({ ...base, missingVars: null, nativeEverSeen: false, lastSeenAt: null }).status).toBe('ci-secret-missing')
  })
  it('stays unknown when CI could not be read but native heartbeats exist', () => {
    expect(sdkDiagnosticVerdict({ ...base, missingVars: null })).toEqual({ status: 'unknown', recommendedFix: '' })
  })
})
