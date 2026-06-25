import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  detectFramework,
  detectPackageManager,
  envVarsToWrite,
  installCommand,
  readPackageJson,
  FRAMEWORKS,
} from './detect.js'

function makeTmp(): string {
  const dir = join(tmpdir(), `mushi-detect-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

function writePkg(dir: string, deps: Record<string, string> = {}, devDeps: Record<string, string> = {}): void {
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'tmp', dependencies: deps, devDependencies: devDeps }),
  )
}

describe('readPackageJson', () => {
  it('returns null when package.json is missing', () => {
    const dir = makeTmp()
    try {
      expect(readPackageJson(dir)).toBeNull()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('returns null when package.json is malformed', () => {
    const dir = makeTmp()
    try {
      writeFileSync(join(dir, 'package.json'), '{ not json')
      expect(readPackageJson(dir)).toBeNull()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('parses a valid package.json', () => {
    const dir = makeTmp()
    try {
      writePkg(dir, { react: '^19.0.0' })
      const pkg = readPackageJson(dir)
      expect(pkg?.dependencies?.react).toBe('^19.0.0')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('detectFramework', () => {
  let dir: string
  beforeEach(() => { dir = makeTmp() })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it('detects Next.js from dependencies', () => {
    writePkg(dir, { next: '^15.0.0', react: '^19.0.0' })
    expect(detectFramework(dir, readPackageJson(dir)).id).toBe('next')
  })

  it('prefers Next.js over plain React when both present', () => {
    writePkg(dir, { react: '^19.0.0', next: '^15.0.0' })
    expect(detectFramework(dir, readPackageJson(dir)).id).toBe('next')
  })

  it('detects Nuxt over Vue', () => {
    writePkg(dir, { vue: '^3.5.0', nuxt: '^4.0.0' })
    expect(detectFramework(dir, readPackageJson(dir)).id).toBe('nuxt')
  })

  it('detects SvelteKit over plain Svelte', () => {
    writePkg(dir, { svelte: '^5.0.0', '@sveltejs/kit': '^2.0.0' })
    expect(detectFramework(dir, readPackageJson(dir)).id).toBe('sveltekit')
  })

  it('detects Expo over react-native', () => {
    writePkg(dir, { 'react-native': '^0.79.0', expo: '^53.0.0' })
    expect(detectFramework(dir, readPackageJson(dir)).id).toBe('expo')
  })

  it('detects Angular', () => {
    writePkg(dir, { '@angular/core': '^17.0.0' })
    expect(detectFramework(dir, readPackageJson(dir)).id).toBe('angular')
  })

  it('detects Capacitor', () => {
    writePkg(dir, { '@capacitor/core': '^6.0.0' })
    expect(detectFramework(dir, readPackageJson(dir)).id).toBe('capacitor')
  })

  it('falls back to vanilla when no recognised dep present', () => {
    writePkg(dir, { lodash: '^4.0.0' })
    expect(detectFramework(dir, readPackageJson(dir)).id).toBe('vanilla')
  })

  it('detects Next.js by config file when package.json is missing', () => {
    writeFileSync(join(dir, 'next.config.js'), '')
    expect(detectFramework(dir, null).id).toBe('next')
  })

  it('checks devDependencies and peerDependencies too', () => {
    writePkg(dir, {}, { vue: '^3.5.0' })
    expect(detectFramework(dir, readPackageJson(dir)).id).toBe('vue')
  })

  it('returns vanilla when nothing matches and no config file present', () => {
    expect(detectFramework(dir, null).id).toBe('vanilla')
  })
})

describe('detectPackageManager', () => {
  let dir: string
  beforeEach(() => {
    dir = makeTmp()
    delete process.env.npm_config_user_agent
  })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it('detects pnpm from lockfile', () => {
    writeFileSync(join(dir, 'pnpm-lock.yaml'), '')
    expect(detectPackageManager(dir)).toBe('pnpm')
  })

  it('detects yarn from lockfile', () => {
    writeFileSync(join(dir, 'yarn.lock'), '')
    expect(detectPackageManager(dir)).toBe('yarn')
  })

  it('detects bun from lockfile', () => {
    writeFileSync(join(dir, 'bun.lockb'), '')
    expect(detectPackageManager(dir)).toBe('bun')
  })

  it('detects npm from package-lock.json', () => {
    writeFileSync(join(dir, 'package-lock.json'), '{}')
    expect(detectPackageManager(dir)).toBe('npm')
  })

  it('falls back to npm with no lockfile and no user agent hint', () => {
    expect(detectPackageManager(dir)).toBe('npm')
  })

  it('uses npm_config_user_agent when no lockfile present', () => {
    process.env.npm_config_user_agent = 'pnpm/10.0.0'
    expect(detectPackageManager(dir)).toBe('pnpm')
    delete process.env.npm_config_user_agent
  })
})

describe('installCommand', () => {
  it('uses install for npm', () => {
    expect(installCommand('npm', ['@mushi-mushi/react'])).toBe('npm install @mushi-mushi/react')
  })
  it('uses add for pnpm/yarn/bun', () => {
    expect(installCommand('pnpm', ['a', 'b'])).toBe('pnpm add a b')
    expect(installCommand('yarn', ['a'])).toBe('yarn add a')
    expect(installCommand('bun', ['a'])).toBe('bun add a')
  })
})

describe('envVarsToWrite', () => {
  it('uses NEXT_PUBLIC_ prefix for Next.js', () => {
    const env = envVarsToWrite('mushi_xxx', 'proj_xxx', FRAMEWORKS.next)
    expect(env).toContain('NEXT_PUBLIC_MUSHI_PROJECT_ID=proj_xxx')
    expect(env).toContain('NEXT_PUBLIC_MUSHI_API_KEY=mushi_xxx')
  })

  it('uses NUXT_PUBLIC_ prefix for Nuxt', () => {
    const env = envVarsToWrite('mushi_xxx', 'proj_xxx', FRAMEWORKS.nuxt)
    expect(env).toContain('NUXT_PUBLIC_MUSHI_PROJECT_ID=proj_xxx')
  })

  it('uses VITE_ prefix for everything else', () => {
    const env = envVarsToWrite('mushi_xxx', 'proj_xxx', FRAMEWORKS.react)
    expect(env).toContain('VITE_MUSHI_PROJECT_ID=proj_xxx')
  })

  it('omits MUSHI_API_ENDPOINT when endpoint is the default cloud URL', () => {
    const cloudEndpoint = 'https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/api'
    const env = envVarsToWrite('mushi_xxx', 'proj_xxx', FRAMEWORKS.next, cloudEndpoint)
    expect(env).not.toContain('MUSHI_API_ENDPOINT')
  })

  it('includes MUSHI_API_ENDPOINT with framework prefix when a custom endpoint is given', () => {
    const selfHosted = 'https://my-instance.example.com/functions/v1/api'
    const env = envVarsToWrite('mushi_xxx', 'proj_xxx', FRAMEWORKS.next, selfHosted)
    expect(env).toContain(`NEXT_PUBLIC_MUSHI_API_ENDPOINT=${selfHosted}`)
  })

  it('includes bare MUSHI_API_ENDPOINT for server frameworks with a custom endpoint', () => {
    const selfHosted = 'https://my-instance.example.com/functions/v1/api'
    const env = envVarsToWrite('mushi_xxx', 'proj_xxx', FRAMEWORKS.express, selfHosted)
    expect(env).toContain(`MUSHI_API_ENDPOINT=${selfHosted}`)
    expect(env).not.toContain('VITE_MUSHI_API_ENDPOINT')
  })

  it('omits endpoint line when no endpoint is provided', () => {
    const env = envVarsToWrite('mushi_xxx', 'proj_xxx', FRAMEWORKS.react)
    expect(env).not.toContain('MUSHI_API_ENDPOINT')
  })
})

describe('FRAMEWORKS', () => {
  it('every framework points at a real @mushi-mushi/* package', () => {
    const validPackages = new Set([
      '@mushi-mushi/react',
      '@mushi-mushi/vue',
      '@mushi-mushi/svelte',
      '@mushi-mushi/angular',
      '@mushi-mushi/react-native',
      '@mushi-mushi/capacitor',
      '@mushi-mushi/web',
      '@mushi-mushi/node',
    ])
    for (const fw of Object.values(FRAMEWORKS)) {
      expect(validPackages.has(fw.packageName)).toBe(true)
    }
  })

  it('snippet always references the correct env var names and the package', () => {
    const VITE_FRAMEWORKS = new Set(['react', 'vue', 'svelte', 'sveltekit', 'angular', 'capacitor', 'vanilla'])
    for (const fw of Object.values(FRAMEWORKS)) {
      const snip = fw.snippet()
      // Every snippet must reference the package it belongs to
      expect(snip).toContain(fw.packageName)
      // Each framework must reference its env vars — not literal key values
      if (fw.id === 'next') {
        expect(snip).toContain('NEXT_PUBLIC_MUSHI_PROJECT_ID')
        expect(snip).toContain('NEXT_PUBLIC_MUSHI_API_KEY')
      } else if (fw.id === 'nuxt') {
        expect(snip).toContain('NUXT_PUBLIC_MUSHI_PROJECT_ID')
        expect(snip).toContain('NUXT_PUBLIC_MUSHI_API_KEY')
      } else if (fw.id === 'expo') {
        expect(snip).toContain('EXPO_PUBLIC_MUSHI_PROJECT_ID')
        expect(snip).toContain('EXPO_PUBLIC_MUSHI_API_KEY')
      } else if (fw.id === 'react-native' || fw.id === 'express' || fw.id === 'fastify' || fw.id === 'hono') {
        expect(snip).toContain('MUSHI_PROJECT_ID')
        expect(snip).toContain('MUSHI_API_KEY')
      } else if (VITE_FRAMEWORKS.has(fw.id)) {
        expect(snip).toContain('VITE_MUSHI_PROJECT_ID')
        expect(snip).toContain('VITE_MUSHI_API_KEY')
      }
    }
  })
})

describe('side-effect cleanup', () => {
  it('temp dirs do not leak (sanity check)', () => {
    const dir = makeTmp()
    rmSync(dir, { recursive: true, force: true })
    expect(existsSync(dir)).toBe(false)
  })
})

describe('detectFramework — Remix / Astro / Solid / CRA', () => {
  let dir: string
  beforeEach(() => { dir = makeTmp() })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it('detects Remix and wins over the bundled react dep', () => {
    writePkg(dir, { '@remix-run/react': '^2.0.0', react: '^18.0.0' })
    expect(detectFramework(dir, readPackageJson(dir)).id).toBe('remix')
  })

  it('detects Astro and wins over react islands', () => {
    writePkg(dir, { astro: '^4.0.0', react: '^18.0.0' })
    expect(detectFramework(dir, readPackageJson(dir)).id).toBe('astro')
  })

  it('detects SolidStart and plain Solid', () => {
    writePkg(dir, { '@solidjs/start': '^1.0.0', 'solid-js': '^1.8.0' })
    expect(detectFramework(dir, readPackageJson(dir)).id).toBe('solid')
    const dir2 = makeTmp()
    try {
      writePkg(dir2, { 'solid-js': '^1.8.0' })
      expect(detectFramework(dir2, readPackageJson(dir2)).id).toBe('solid')
    } finally {
      rmSync(dir2, { recursive: true, force: true })
    }
  })

  it('detects Create React App (react-scripts) over plain react', () => {
    writePkg(dir, { react: '^18.0.0', 'react-scripts': '5.0.1' })
    expect(detectFramework(dir, readPackageJson(dir)).id).toBe('cra')
  })

  it('plain react (Vite) is still react, not cra', () => {
    writePkg(dir, { react: '^18.0.0' })
    expect(detectFramework(dir, readPackageJson(dir)).id).toBe('react')
  })

  it('detects Remix and Astro from config files', () => {
    writePkg(dir, {})
    writeFileSync(join(dir, 'astro.config.mjs'), 'export default {}')
    expect(detectFramework(dir, readPackageJson(dir)).id).toBe('astro')
  })
})

describe('envVarsToWrite — new framework prefixes', () => {
  const key = 'mushi_test_key_abcdefghijklmnop'
  const pid = '00000000-0000-0000-0000-000000000001'

  it('CRA uses REACT_APP_ prefix', () => {
    const out = envVarsToWrite(key, pid, FRAMEWORKS.cra)
    expect(out).toContain(`REACT_APP_MUSHI_PROJECT_ID=${pid}`)
    expect(out).toContain(`REACT_APP_MUSHI_API_KEY=${key}`)
  })

  it('Astro uses PUBLIC_ prefix', () => {
    const out = envVarsToWrite(key, pid, FRAMEWORKS.astro)
    expect(out).toContain(`PUBLIC_MUSHI_PROJECT_ID=${pid}`)
  })

  it('Solid uses VITE_ prefix', () => {
    const out = envVarsToWrite(key, pid, FRAMEWORKS.solid)
    expect(out).toContain(`VITE_MUSHI_PROJECT_ID=${pid}`)
  })

  it('Remix uses bare MUSHI_ names (runtime window.ENV)', () => {
    const out = envVarsToWrite(key, pid, FRAMEWORKS.remix)
    expect(out).toContain(`MUSHI_PROJECT_ID=${pid}`)
    expect(out).not.toContain('VITE_')
    expect(out).not.toContain('PUBLIC_')
  })
})
