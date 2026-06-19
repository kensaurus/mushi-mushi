import { describe, expect, it } from 'vitest'
import {
  bundlerKindForFramework,
  mushiEnvVarsForBundler,
  mushiEnvVarsForProjectSlug,
} from './projectMushiEnv'

describe('mushiEnvVarsForProjectSlug', () => {
  it('uses Vite self vars for mushi-mushi admin dogfood', () => {
    const env = mushiEnvVarsForProjectSlug('mushi-mushi')
    expect(env.apiKeyVar).toBe('VITE_MUSHI_SELF_API_KEY')
    expect(env.projectIdVar).toBe('VITE_MUSHI_SELF_PROJECT_ID')
  })

  it('uses Expo public vars for yen-yen', () => {
    const env = mushiEnvVarsForProjectSlug('yen-yen')
    expect(env.apiKeyVar).toBe('EXPO_PUBLIC_MUSHI_API_KEY')
    expect(env.envFileHint).toBe('apps/mobile/.env.local')
    expect(env.ciVars?.projectId.name).toBe('EXPO_PUBLIC_MUSHI_PROJECT_ID')
    expect(env.ciVars?.apiKey.ghKind).toBe('secret')
  })

  it('uses Vite vars for solo-boss-cloud', () => {
    const env = mushiEnvVarsForProjectSlug('solo-boss-cloud')
    expect(env.apiKeyVar).toBe('VITE_MUSHI_API_KEY')
  })

  it('defaults to Next public vars for unknown slugs', () => {
    const env = mushiEnvVarsForProjectSlug('my-app')
    expect(env.apiKeyVar).toBe('NEXT_PUBLIC_MUSHI_API_KEY')
  })
})

describe('bundlerKindForFramework', () => {
  it("maps 'next' to the Next bundler so the SDK gets NEXT_PUBLIC_ vars", () => {
    // Regression: 'next' used to fall through to 'none', producing unprefixed
    // MUSHI_PROJECT_ID that a Next bundle never inlines (silently disabled SDK).
    expect(bundlerKindForFramework('next')).toBe('next')
    const env = mushiEnvVarsForBundler(bundlerKindForFramework('next'))
    expect(env.projectIdVar).toBe('NEXT_PUBLIC_MUSHI_PROJECT_ID')
    expect(env.apiKeyVar).toBe('NEXT_PUBLIC_MUSHI_API_KEY')
  })

  it("maps 'nuxt' to the Nuxt bundler (NUXT_PUBLIC_ vars)", () => {
    expect(bundlerKindForFramework('nuxt')).toBe('nuxt')
    expect(mushiEnvVarsForBundler(bundlerKindForFramework('nuxt')).apiKeyVar).toBe(
      'NUXT_PUBLIC_MUSHI_API_KEY',
    )
  })

  it('maps react/vue/svelte to Vite and expo to Expo', () => {
    expect(bundlerKindForFramework('react')).toBe('vite')
    expect(bundlerKindForFramework('vue')).toBe('vite')
    expect(bundlerKindForFramework('svelte')).toBe('vite')
    expect(bundlerKindForFramework('expo')).toBe('expo')
    expect(bundlerKindForFramework('react-native')).toBe('expo')
  })

  it('falls back to the loader (none) for vanilla / unknown / nullish', () => {
    expect(bundlerKindForFramework('vanilla')).toBe('none')
    expect(bundlerKindForFramework('angular')).toBe('none')
    expect(bundlerKindForFramework(null)).toBe('none')
    expect(bundlerKindForFramework(undefined)).toBe('none')
  })
})
