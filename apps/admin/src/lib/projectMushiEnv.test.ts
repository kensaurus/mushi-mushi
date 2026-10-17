import { describe, expect, it } from 'vitest'
import {
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

describe('mushiEnvVarsForBundler', () => {
  it('gives the Next bundler NEXT_PUBLIC_ vars, which a Next build inlines', () => {
    const env = mushiEnvVarsForBundler('next')
    expect(env.projectIdVar).toBe('NEXT_PUBLIC_MUSHI_PROJECT_ID')
    expect(env.apiKeyVar).toBe('NEXT_PUBLIC_MUSHI_API_KEY')
  })

  it('gives the Nuxt bundler NUXT_PUBLIC_ vars', () => {
    expect(mushiEnvVarsForBundler('nuxt').apiKeyVar).toBe('NUXT_PUBLIC_MUSHI_API_KEY')
  })
})
