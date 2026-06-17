import { describe, it, expect } from 'vitest'
import {
  buildGuidedFallbackCommands,
  sdkCiStatusMeta,
  type SdkDiagnosticStatus,
} from './sdkCiSecrets'

describe('buildGuidedFallbackCommands', () => {
  const base = {
    repo: 'kensaurus/glot.it',
    projectId: '542b34e0-019e-41fe-b900-7b637717bb86',
    endpoint: 'https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/api',
    rawKey: 'mushi_abc123fakekey',
  }

  it('generates gh commands for Next.js (glot-it)', () => {
    const { commands, varRows } = buildGuidedFallbackCommands({ ...base, slug: 'glot-it' })

    expect(commands).toHaveLength(3) // projectId + apiKey + endpoint
    expect(commands[0]).toContain('gh variable set NEXT_PUBLIC_MUSHI_PROJECT_ID')
    expect(commands[1]).toContain('gh secret set NEXT_PUBLIC_MUSHI_API_KEY')
    expect(commands[2]).toContain('gh variable set NEXT_PUBLIC_MUSHI_API_ENDPOINT')
    expect(commands.every((c) => c.includes('--repo kensaurus/glot.it'))).toBe(true)

    // API key row must be ghKind:secret, others variable
    const keyRow = varRows.find((r) => r.name === 'NEXT_PUBLIC_MUSHI_API_KEY')
    expect(keyRow?.ghKind).toBe('secret')
    expect(keyRow?.value).toBe('mushi_abc123fakekey')
  })

  it('generates EXPO_PUBLIC vars for yen-yen', () => {
    const { commands } = buildGuidedFallbackCommands({ ...base, slug: 'yen-yen' })
    expect(commands[0]).toContain('EXPO_PUBLIC_MUSHI_PROJECT_ID')
    expect(commands[1]).toContain('EXPO_PUBLIC_MUSHI_API_KEY')
  })

  it('produces a valid YAML env block', () => {
    const { envBlock } = buildGuidedFallbackCommands({ ...base, slug: 'glot-it' })
    expect(envBlock).toContain('env:')
    expect(envBlock).toContain('NEXT_PUBLIC_MUSHI_PROJECT_ID: ${{ vars.NEXT_PUBLIC_MUSHI_PROJECT_ID }}')
    expect(envBlock).toContain('NEXT_PUBLIC_MUSHI_API_KEY: ${{ secrets.NEXT_PUBLIC_MUSHI_API_KEY }}')
  })

  it('hides the raw key in variable commands, shows it in secret commands', () => {
    const { commands } = buildGuidedFallbackCommands({ ...base, slug: 'glot-it' })
    const secretCmd = commands.find((c) => c.includes('gh secret set'))
    expect(secretCmd).toContain(base.rawKey)
  })
})

describe('sdkCiStatusMeta', () => {
  const statuses: SdkDiagnosticStatus[] = [
    'healthy',
    'ci-secret-missing',
    'native-never-seen',
    'banner-disabled',
    'unknown',
  ]

  it.each(statuses)('returns a meta object for status %s', (status) => {
    const meta = sdkCiStatusMeta(status, true)
    expect(meta.label).toBeTruthy()
    expect(meta.description).toBeTruthy()
    expect(['ok', 'warn', 'error']).toContain(meta.severity)
  })

  it('shows "Sync CI secrets automatically" CTA when GitHub token present + missing', () => {
    const meta = sdkCiStatusMeta('ci-secret-missing', true)
    expect(meta.cta).toContain('automatically')
  })

  it('shows copy fallback CTA when no GitHub token', () => {
    const meta = sdkCiStatusMeta('ci-secret-missing', false)
    expect(meta.cta.toLowerCase()).toContain('copy')
  })
})
