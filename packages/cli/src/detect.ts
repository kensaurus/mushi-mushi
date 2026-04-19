/**
 * FILE: packages/cli/src/detect.ts
 * PURPOSE: Pure detection helpers for framework, package manager, and project state.
 *          Kept side-effect-free so the wizard remains unit-testable.
 */

import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

export type FrameworkId =
  | 'next'
  | 'react'
  | 'vue'
  | 'nuxt'
  | 'svelte'
  | 'sveltekit'
  | 'angular'
  | 'expo'
  | 'react-native'
  | 'capacitor'
  | 'vanilla'

export interface Framework {
  id: FrameworkId
  label: string
  packageName: string
  needsWebPackage: boolean
  snippet: (apiKey: string, projectId: string) => string
}

export interface PackageJson {
  name?: string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun'

export const FRAMEWORKS: Record<FrameworkId, Framework> = {
  next: {
    id: 'next',
    label: 'Next.js',
    packageName: '@mushi-mushi/react',
    needsWebPackage: false,
    snippet: (apiKey, projectId) => `// app/providers.tsx (or pages/_app.tsx for /pages router)
'use client'
import { MushiProvider } from '@mushi-mushi/react'

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <MushiProvider config={{
      projectId: '${projectId}',
      apiKey: '${apiKey}',
    }}>
      {children}
    </MushiProvider>
  )
}`,
  },
  react: {
    id: 'react',
    label: 'React',
    packageName: '@mushi-mushi/react',
    needsWebPackage: false,
    snippet: (apiKey, projectId) => `// src/main.tsx
import { MushiProvider } from '@mushi-mushi/react'

createRoot(document.getElementById('root')!).render(
  <MushiProvider config={{
    projectId: '${projectId}',
    apiKey: '${apiKey}',
  }}>
    <App />
  </MushiProvider>
)`,
  },
  vue: {
    id: 'vue',
    label: 'Vue 3',
    packageName: '@mushi-mushi/vue',
    needsWebPackage: true,
    snippet: (apiKey, projectId) => `// src/main.ts
import { MushiPlugin } from '@mushi-mushi/vue'
import { Mushi } from '@mushi-mushi/web'

app.use(MushiPlugin, { projectId: '${projectId}', apiKey: '${apiKey}' })
Mushi.init({ projectId: '${projectId}', apiKey: '${apiKey}' })`,
  },
  nuxt: {
    id: 'nuxt',
    label: 'Nuxt',
    packageName: '@mushi-mushi/vue',
    needsWebPackage: true,
    snippet: (apiKey, projectId) => `// plugins/mushi.client.ts
import { MushiPlugin } from '@mushi-mushi/vue'
import { Mushi } from '@mushi-mushi/web'

export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vueApp.use(MushiPlugin, {
    projectId: '${projectId}',
    apiKey: '${apiKey}',
  })
  Mushi.init({ projectId: '${projectId}', apiKey: '${apiKey}' })
})`,
  },
  svelte: {
    id: 'svelte',
    label: 'Svelte',
    packageName: '@mushi-mushi/svelte',
    needsWebPackage: true,
    snippet: (apiKey, projectId) => `// src/main.ts (or +layout.svelte for SvelteKit)
import { initMushi } from '@mushi-mushi/svelte'
import { Mushi } from '@mushi-mushi/web'

initMushi({ projectId: '${projectId}', apiKey: '${apiKey}' })
Mushi.init({ projectId: '${projectId}', apiKey: '${apiKey}' })`,
  },
  sveltekit: {
    id: 'sveltekit',
    label: 'SvelteKit',
    packageName: '@mushi-mushi/svelte',
    needsWebPackage: true,
    snippet: (apiKey, projectId) => `// src/routes/+layout.svelte
<script>
  import { onMount } from 'svelte'
  import { initMushi } from '@mushi-mushi/svelte'

  onMount(async () => {
    const { Mushi } = await import('@mushi-mushi/web')
    initMushi({ projectId: '${projectId}', apiKey: '${apiKey}' })
    Mushi.init({ projectId: '${projectId}', apiKey: '${apiKey}' })
  })
</script>`,
  },
  angular: {
    id: 'angular',
    label: 'Angular',
    packageName: '@mushi-mushi/angular',
    needsWebPackage: true,
    snippet: (apiKey, projectId) => `// src/main.ts
import { provideMushi } from '@mushi-mushi/angular'
import { Mushi } from '@mushi-mushi/web'

bootstrapApplication(AppComponent, {
  providers: [
    provideMushi({ projectId: '${projectId}', apiKey: '${apiKey}' }),
  ],
})
Mushi.init({ projectId: '${projectId}', apiKey: '${apiKey}' })`,
  },
  expo: {
    id: 'expo',
    label: 'Expo',
    packageName: '@mushi-mushi/react-native',
    needsWebPackage: false,
    snippet: (apiKey, projectId) => `// App.tsx
import { MushiProvider } from '@mushi-mushi/react-native'

export default function App() {
  return (
    <MushiProvider projectId="${projectId}" apiKey="${apiKey}">
      <YourApp />
    </MushiProvider>
  )
}`,
  },
  'react-native': {
    id: 'react-native',
    label: 'React Native',
    packageName: '@mushi-mushi/react-native',
    needsWebPackage: false,
    snippet: (apiKey, projectId) => `// App.tsx
import { MushiProvider } from '@mushi-mushi/react-native'

export default function App() {
  return (
    <MushiProvider projectId="${projectId}" apiKey="${apiKey}">
      <YourApp />
    </MushiProvider>
  )
}`,
  },
  capacitor: {
    id: 'capacitor',
    label: 'Capacitor (Ionic)',
    packageName: '@mushi-mushi/capacitor',
    needsWebPackage: false,
    snippet: (apiKey, projectId) => `// src/main.ts
import { Mushi } from '@mushi-mushi/capacitor'

Mushi.init({ projectId: '${projectId}', apiKey: '${apiKey}' })`,
  },
  vanilla: {
    id: 'vanilla',
    label: 'Vanilla JS / unknown',
    packageName: '@mushi-mushi/web',
    needsWebPackage: false,
    snippet: (apiKey, projectId) => `// Anywhere in your client bundle
import { Mushi } from '@mushi-mushi/web'

Mushi.init({ projectId: '${projectId}', apiKey: '${apiKey}' })`,
  },
}

export function readPackageJson(cwd: string): PackageJson | null {
  const path = join(cwd, 'package.json')
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as PackageJson
  } catch {
    return null
  }
}

export function detectFramework(cwd: string, pkg: PackageJson | null): Framework {
  const deps = collectDeps(pkg)

  if (deps.has('next')) return FRAMEWORKS.next
  if (deps.has('nuxt')) return FRAMEWORKS.nuxt
  if (deps.has('@sveltejs/kit')) return FRAMEWORKS.sveltekit
  if (deps.has('@angular/core')) return FRAMEWORKS.angular
  if (deps.has('expo')) return FRAMEWORKS.expo
  if (deps.has('react-native')) return FRAMEWORKS['react-native']
  if (deps.has('@capacitor/core')) return FRAMEWORKS.capacitor
  if (deps.has('svelte')) return FRAMEWORKS.svelte
  if (deps.has('vue')) return FRAMEWORKS.vue
  if (deps.has('react')) return FRAMEWORKS.react

  if (existsSync(join(cwd, 'next.config.js')) || existsSync(join(cwd, 'next.config.ts'))) {
    return FRAMEWORKS.next
  }
  if (existsSync(join(cwd, 'nuxt.config.ts')) || existsSync(join(cwd, 'nuxt.config.js'))) {
    return FRAMEWORKS.nuxt
  }
  if (existsSync(join(cwd, 'svelte.config.js'))) return FRAMEWORKS.svelte
  if (existsSync(join(cwd, 'angular.json'))) return FRAMEWORKS.angular

  return FRAMEWORKS.vanilla
}

export function detectPackageManager(cwd: string): PackageManager {
  if (existsSync(join(cwd, 'bun.lockb')) || existsSync(join(cwd, 'bun.lock'))) return 'bun'
  if (existsSync(join(cwd, 'pnpm-lock.yaml'))) return 'pnpm'
  if (existsSync(join(cwd, 'yarn.lock'))) return 'yarn'
  if (existsSync(join(cwd, 'package-lock.json'))) return 'npm'

  const userAgent = process.env.npm_config_user_agent ?? ''
  if (userAgent.startsWith('bun')) return 'bun'
  if (userAgent.startsWith('pnpm')) return 'pnpm'
  if (userAgent.startsWith('yarn')) return 'yarn'

  return 'npm'
}

export function installCommand(pm: PackageManager, packages: string[]): string {
  const verb = pm === 'npm' ? 'install' : 'add'
  return `${pm} ${verb} ${packages.join(' ')}`
}

export function envVarsToWrite(apiKey: string, projectId: string, framework: Framework): string {
  const prefix = framework.id === 'next' ? 'NEXT_PUBLIC_' : framework.id === 'nuxt' ? 'NUXT_PUBLIC_' : 'VITE_'
  return [
    `${prefix}MUSHI_PROJECT_ID=${projectId}`,
    `${prefix}MUSHI_API_KEY=${apiKey}`,
  ].join('\n')
}

function collectDeps(pkg: PackageJson | null): Set<string> {
  if (!pkg) return new Set()
  return new Set([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
    ...Object.keys(pkg.peerDependencies ?? {}),
  ])
}
