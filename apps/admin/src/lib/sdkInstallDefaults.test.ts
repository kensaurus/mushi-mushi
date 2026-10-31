import { describe, expect, it } from 'vitest'
import { detectWebBundler, resolveDefaultSdkFramework } from './sdkInstallDefaults'
import { renderSnippet } from './sdkSnippets'

describe('resolveDefaultSdkFramework', () => {
  it('prefers expo for yen-yen slug', () => {
    expect(resolveDefaultSdkFramework('yen-yen')).toBe('expo')
    expect(resolveDefaultSdkFramework('YenYen')).toBe('expo')
  })

  it('detects expo from package.json when confidence is high', () => {
    const pkg = JSON.stringify({
      dependencies: { expo: '~52.0.0', 'react-native': '0.76.0' },
    })
    expect(resolveDefaultSdkFramework('my-app', pkg)).toBe('expo')
  })

  it('falls back to react for unknown slug without package.json', () => {
    expect(resolveDefaultSdkFramework('my-app')).toBe('react')
  })

  it('picks a web framework the app’s package.json names', () => {
    const vue = JSON.stringify({ dependencies: { vue: '3.5.0' }, devDependencies: { vite: '7.0.0' } })
    expect(resolveDefaultSdkFramework('site', vue)).toBe('vue')
  })
})

describe('detectWebBundler', () => {
  it('reads Vite and Next from dependencies', () => {
    expect(detectWebBundler(JSON.stringify({ devDependencies: { vite: '7' }, dependencies: { react: '19' } }))).toBe('vite')
    expect(detectWebBundler(JSON.stringify({ dependencies: { next: '16', react: '19' } }))).toBe('next')
    expect(detectWebBundler(JSON.stringify({ dependencies: { react: '19' } }))).toBeNull()
    expect(detectWebBundler('not json')).toBeNull()
    expect(detectWebBundler(null)).toBeNull()
  })
})

describe('renderSnippet for a React app on Vite or Next', () => {
  it('reads the id and key from env vars and lists the .env.local lines', () => {
    const vite = renderSnippet('react', 'p-1', 'mushi_k', undefined, null, 'vite')
    expect(vite).toContain('// VITE_MUSHI_PROJECT_ID=p-1')
    expect(vite).toContain('// VITE_MUSHI_API_KEY=mushi_k')
    expect(vite).toContain('projectId: import.meta.env.VITE_MUSHI_PROJECT_ID')
    expect(vite).not.toContain("apiKey: 'mushi_k'")
    const next = renderSnippet('react', 'p-1', 'mushi_k', undefined, null, 'next')
    expect(next).toContain("'use client'")
    expect(next).toContain('apiKey: process.env.NEXT_PUBLIC_MUSHI_API_KEY')
  })

  it('keeps the inline snippet when the bundler is unknown', () => {
    expect(renderSnippet('react', 'p-1', 'mushi_k')).toContain("apiKey: 'mushi_k'")
  })
})

