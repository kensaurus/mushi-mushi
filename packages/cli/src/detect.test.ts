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
    ])
    for (const fw of Object.values(FRAMEWORKS)) {
      expect(validPackages.has(fw.packageName)).toBe(true)
    }
  })

  it('snippet always references the chosen package and the supplied keys', () => {
    for (const fw of Object.values(FRAMEWORKS)) {
      const snip = fw.snippet('mushi_test_key', 'proj_test_id')
      expect(snip).toContain('mushi_test_key')
      expect(snip).toContain('proj_test_id')
      expect(snip).toContain(fw.packageName)
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
