import { describe, expect, it } from 'vitest'
import { mushiEnvVarsForProjectSlug } from './projectMushiEnv'

describe('mushiEnvVarsForProjectSlug', () => {
  it('uses Vite self vars for mushi-mushi admin dogfood', () => {
    const env = mushiEnvVarsForProjectSlug('mushi-mushi')
    expect(env.apiKeyVar).toBe('VITE_MUSHI_SELF_API_KEY')
    expect(env.projectIdVar).toBe('VITE_MUSHI_SELF_PROJECT_ID')
  })

  it('uses Expo public vars for yen-yen', () => {
    const env = mushiEnvVarsForProjectSlug('yen-yen')
    expect(env.apiKeyVar).toBe('EXPO_PUBLIC_MUSHI_API_KEY')
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
