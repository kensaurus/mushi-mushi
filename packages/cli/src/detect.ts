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
  | 'cra'
  | 'remix'
  | 'astro'
  | 'solid'
  | 'vue'
  | 'nuxt'
  | 'svelte'
  | 'sveltekit'
  | 'angular'
  | 'expo'
  | 'react-native'
  | 'capacitor'
  | 'express'
  | 'fastify'
  | 'hono'
  | 'vanilla'

export interface Framework {
  id: FrameworkId
  label: string
  packageName: string
  needsWebPackage: boolean
  snippet: () => string
}

export interface PackageJson {
  name?: string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun'

export const FRAMEWORK_IDS: ReadonlyArray<FrameworkId> = [
  'next',
  'react',
  'cra',
  'remix',
  'astro',
  'solid',
  'vue',
  'nuxt',
  'svelte',
  'sveltekit',
  'angular',
  'expo',
  'react-native',
  'capacitor',
  'express',
  'fastify',
  'hono',
  'vanilla',
]

export function isFrameworkId(value: unknown): value is FrameworkId {
  return typeof value === 'string' && (FRAMEWORK_IDS as ReadonlyArray<string>).includes(value)
}

export const FRAMEWORKS: Record<FrameworkId, Framework> = {
  next: {
    id: 'next',
    label: 'Next.js',
    packageName: '@mushi-mushi/react',
    needsWebPackage: false,
    snippet: () => `// app/providers.tsx (or pages/_app.tsx for /pages router)
'use client'
import { MushiProvider } from '@mushi-mushi/react'

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <MushiProvider config={{
      projectId: process.env.NEXT_PUBLIC_MUSHI_PROJECT_ID!,
      apiKey: process.env.NEXT_PUBLIC_MUSHI_API_KEY!,
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
    snippet: () => `// src/main.tsx
import { MushiProvider } from '@mushi-mushi/react'

createRoot(document.getElementById('root')!).render(
  <MushiProvider config={{
    projectId: import.meta.env.VITE_MUSHI_PROJECT_ID,
    apiKey: import.meta.env.VITE_MUSHI_API_KEY,
  }}>
    <App />
  </MushiProvider>
)`,
  },
  cra: {
    id: 'cra',
    label: 'Create React App',
    packageName: '@mushi-mushi/react',
    needsWebPackage: false,
    // CRA inlines only REACT_APP_*-prefixed vars into process.env at build time.
    snippet: () => `// src/index.tsx
import { MushiProvider } from '@mushi-mushi/react'

root.render(
  <MushiProvider config={{
    projectId: process.env.REACT_APP_MUSHI_PROJECT_ID,
    apiKey: process.env.REACT_APP_MUSHI_API_KEY,
  }}>
    <App />
  </MushiProvider>
)`,
  },
  remix: {
    id: 'remix',
    label: 'Remix',
    packageName: '@mushi-mushi/react',
    needsWebPackage: false,
    // Remix doesn't inline client env. Expose public values at runtime via the
    // root loader + window.ENV (works on both the classic compiler and Vite).
    snippet: () => `// app/root.tsx
import { MushiProvider } from '@mushi-mushi/react'
import { useLoaderData } from '@remix-run/react'

export async function loader() {
  return { ENV: {
    MUSHI_PROJECT_ID: process.env.MUSHI_PROJECT_ID,
    MUSHI_API_KEY: process.env.MUSHI_API_KEY,
  } }
}

export default function App() {
  const { ENV } = useLoaderData<typeof loader>()
  return (
    <html>
      <body>
        <MushiProvider config={{ projectId: ENV.MUSHI_PROJECT_ID, apiKey: ENV.MUSHI_API_KEY }}>
          <Outlet />
        </MushiProvider>
        <Scripts />
      </body>
    </html>
  )
}`,
  },
  astro: {
    id: 'astro',
    label: 'Astro',
    packageName: '@mushi-mushi/web',
    needsWebPackage: false,
    // Astro exposes only PUBLIC_*-prefixed vars to client code (Vite-based).
    snippet: () => `---
// src/layouts/Layout.astro (add this <script> once, e.g. in your base layout)
---
<script>
  import { Mushi } from '@mushi-mushi/web'
  Mushi.init({
    projectId: import.meta.env.PUBLIC_MUSHI_PROJECT_ID,
    apiKey: import.meta.env.PUBLIC_MUSHI_API_KEY,
  })
</script>`,
  },
  solid: {
    id: 'solid',
    label: 'Solid',
    packageName: '@mushi-mushi/web',
    needsWebPackage: false,
    // Solid / SolidStart are Vite-based → VITE_*-prefixed client env.
    snippet: () => `// src/index.tsx (or src/app.tsx for SolidStart)
import { onMount } from 'solid-js'
import { Mushi } from '@mushi-mushi/web'

onMount(() => {
  Mushi.init({
    projectId: import.meta.env.VITE_MUSHI_PROJECT_ID,
    apiKey: import.meta.env.VITE_MUSHI_API_KEY,
  })
})`,
  },
  vue: {
    id: 'vue',
    label: 'Vue 3',
    packageName: '@mushi-mushi/vue',
    needsWebPackage: false,
    snippet: () => `// src/main.ts
import { MushiPlugin } from '@mushi-mushi/vue'

app.use(MushiPlugin, {
  projectId: import.meta.env.VITE_MUSHI_PROJECT_ID,
  apiKey: import.meta.env.VITE_MUSHI_API_KEY,
})`,
  },
  nuxt: {
    id: 'nuxt',
    label: 'Nuxt',
    packageName: '@mushi-mushi/vue',
    needsWebPackage: false,
    snippet: () => `// plugins/mushi.client.ts
import { MushiPlugin } from '@mushi-mushi/vue'

export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vueApp.use(MushiPlugin, {
    projectId: import.meta.env.NUXT_PUBLIC_MUSHI_PROJECT_ID,
    apiKey: import.meta.env.NUXT_PUBLIC_MUSHI_API_KEY,
  })
})`,
  },
  svelte: {
    id: 'svelte',
    label: 'Svelte',
    packageName: '@mushi-mushi/svelte',
    needsWebPackage: false,
    snippet: () => `// src/main.ts
import { initMushi } from '@mushi-mushi/svelte'

initMushi({
  projectId: import.meta.env.VITE_MUSHI_PROJECT_ID,
  apiKey: import.meta.env.VITE_MUSHI_API_KEY,
})`,
  },
  sveltekit: {
    id: 'sveltekit',
    label: 'SvelteKit',
    packageName: '@mushi-mushi/svelte',
    needsWebPackage: false,
    snippet: () => `// src/routes/+layout.svelte
<script>
  import { onMount } from 'svelte'

  onMount(async () => {
    const { initMushi } = await import('@mushi-mushi/svelte')
    initMushi({
      projectId: import.meta.env.VITE_MUSHI_PROJECT_ID,
      apiKey: import.meta.env.VITE_MUSHI_API_KEY,
    })
  })
</script>`,
  },
  angular: {
    id: 'angular',
    label: 'Angular',
    packageName: '@mushi-mushi/angular',
    needsWebPackage: false,
    snippet: () => `// src/main.ts
import { provideMushi } from '@mushi-mushi/angular'

bootstrapApplication(AppComponent, {
  providers: [
    provideMushi({
      projectId: import.meta.env.VITE_MUSHI_PROJECT_ID,
      apiKey: import.meta.env.VITE_MUSHI_API_KEY,
    }),
  ],
})`,
  },
  expo: {
    id: 'expo',
    label: 'Expo',
    packageName: '@mushi-mushi/react-native',
    needsWebPackage: false,
    snippet: () => `// App.tsx
import { MushiProvider } from '@mushi-mushi/react-native'

export default function App() {
  return (
    <MushiProvider
      projectId={process.env.EXPO_PUBLIC_MUSHI_PROJECT_ID!}
      apiKey={process.env.EXPO_PUBLIC_MUSHI_API_KEY!}
    >
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
    snippet: () => `// App.tsx
import { MushiProvider } from '@mushi-mushi/react-native'

export default function App() {
  return (
    <MushiProvider
      projectId={process.env.MUSHI_PROJECT_ID!}
      apiKey={process.env.MUSHI_API_KEY!}
    >
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
    /* The Capacitor plugin's public API is `Mushi.configure(...)`, not
     * `Mushi.init(...)` — see packages/capacitor/src/definitions.ts. We
     * shipped the wrong call here for two releases and users got a runtime
     * `TypeError: Mushi.init is not a function`. The accompanying admin
     * console snippet (apps/admin/src/lib/sdkSnippets.ts) emits the same
     * `Mushi.configure(...)` shape; both are pinned by tests. */
    snippet: () => `// src/main.ts — after install, run \`npx cap sync\`
import { Mushi } from '@mushi-mushi/capacitor'

await Mushi.configure({
  projectId: import.meta.env.VITE_MUSHI_PROJECT_ID,
  apiKey: import.meta.env.VITE_MUSHI_API_KEY,
})`,
  },
  express: {
    id: 'express',
    label: 'Express',
    packageName: '@mushi-mushi/node',
    needsWebPackage: false,
    snippet: () => `// src/instrument.ts — load with: node --import ./dist/instrument.js
import { MushiNodeClient, attachUnhandledHook } from '@mushi-mushi/node'
import { mushiExpressErrorHandler } from '@mushi-mushi/node/express'
import type { Express } from 'express'

export const mushi = new MushiNodeClient({
  projectId: process.env.MUSHI_PROJECT_ID!,
  apiKey: process.env.MUSHI_API_KEY!,
  environment: process.env.NODE_ENV ?? 'production',
})
attachUnhandledHook({ client: mushi })

export function attachMushi(app: Express) {
  app.use(mushiExpressErrorHandler({ client: mushi }))
}`,
  },
  fastify: {
    id: 'fastify',
    label: 'Fastify',
    packageName: '@mushi-mushi/node',
    needsWebPackage: false,
    snippet: () => `// src/instrument.ts — load with: node --import ./dist/instrument.js
import { MushiNodeClient, attachUnhandledHook } from '@mushi-mushi/node'
import { mushiFastifyPlugin } from '@mushi-mushi/node/fastify'
import Fastify from 'fastify'

export const mushi = new MushiNodeClient({
  projectId: process.env.MUSHI_PROJECT_ID!,
  apiKey: process.env.MUSHI_API_KEY!,
  environment: process.env.NODE_ENV ?? 'production',
})
attachUnhandledHook({ client: mushi })

const app = Fastify()
mushiFastifyPlugin(app, { client: mushi })`,
  },
  hono: {
    id: 'hono',
    label: 'Hono',
    packageName: '@mushi-mushi/node',
    needsWebPackage: false,
    snippet: () => `// src/instrument.ts — load with: node --import ./dist/instrument.js
import { MushiNodeClient, attachUnhandledHook } from '@mushi-mushi/node'
import { mushiHonoErrorHandler } from '@mushi-mushi/node/hono'
import { Hono } from 'hono'

export const mushi = new MushiNodeClient({
  projectId: process.env.MUSHI_PROJECT_ID!,
  apiKey: process.env.MUSHI_API_KEY!,
  environment: process.env.NODE_ENV ?? 'production',
})
attachUnhandledHook({ client: mushi })

const app = new Hono()
app.onError(
  mushiHonoErrorHandler({ client: mushi }, (err, c) =>
    c.text('Internal Server Error', 500),
  ),
)`,
  },
  vanilla: {
    id: 'vanilla',
    label: 'Vanilla JS / unknown',
    packageName: '@mushi-mushi/web',
    needsWebPackage: false,
    snippet: () => `// Anywhere in your client bundle
import { Mushi } from '@mushi-mushi/web'

Mushi.init({
  projectId: import.meta.env.VITE_MUSHI_PROJECT_ID,
  apiKey: import.meta.env.VITE_MUSHI_API_KEY,
})`,
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
  // Meta-frameworks that bundle React/Vue/Solid islands — detect before the
  // bare react/vue/solid deps they ship with.
  if (deps.has('@remix-run/react') || deps.has('@remix-run/node') || deps.has('@remix-run/serve')) {
    return FRAMEWORKS.remix
  }
  if (deps.has('astro')) return FRAMEWORKS.astro
  if (deps.has('@solidjs/start') || deps.has('solid-js')) return FRAMEWORKS.solid
  if (deps.has('@capacitor/core') && deps.has('react')) return FRAMEWORKS.react
  if (deps.has('@capacitor/core')) return FRAMEWORKS.capacitor
  if (deps.has('svelte')) return FRAMEWORKS.svelte
  if (deps.has('vue')) return FRAMEWORKS.vue
  // Create React App ships React + react-scripts and needs the REACT_APP_
  // env prefix — detect before plain react (which assumes a Vite bundler).
  if (deps.has('react-scripts')) return FRAMEWORKS.cra
  if (deps.has('react')) return FRAMEWORKS.react
  // Server-side frameworks — detected after client frameworks so a Next.js
  // app that incidentally has `express` in devDependencies (for testing) is
  // not mis-classified as an Express project.
  if (deps.has('express')) return FRAMEWORKS.express
  if (deps.has('fastify')) return FRAMEWORKS.fastify
  if (deps.has('hono') || deps.has('@hono/hono')) return FRAMEWORKS.hono

  if (existsSync(join(cwd, 'next.config.js')) || existsSync(join(cwd, 'next.config.ts'))) {
    return FRAMEWORKS.next
  }
  if (existsSync(join(cwd, 'nuxt.config.ts')) || existsSync(join(cwd, 'nuxt.config.js'))) {
    return FRAMEWORKS.nuxt
  }
  if (existsSync(join(cwd, 'svelte.config.js'))) return FRAMEWORKS.svelte
  if (existsSync(join(cwd, 'angular.json'))) return FRAMEWORKS.angular
  if (existsSync(join(cwd, 'remix.config.js')) || existsSync(join(cwd, 'remix.config.ts'))) {
    return FRAMEWORKS.remix
  }
  if (existsSync(join(cwd, 'astro.config.mjs')) || existsSync(join(cwd, 'astro.config.ts')) || existsSync(join(cwd, 'astro.config.js'))) {
    return FRAMEWORKS.astro
  }

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

const SERVER_FRAMEWORK_IDS: ReadonlySet<FrameworkId> = new Set(['express', 'fastify', 'hono'])

export function envVarsToWrite(
  apiKey: string,
  projectId: string,
  framework: Framework,
  endpoint?: string,
): string {
  const CLOUD_ENDPOINT = 'https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/api'
  const endpointLine = endpoint && endpoint !== CLOUD_ENDPOINT
    ? `MUSHI_API_ENDPOINT=${endpoint}`
    : null

  // Server frameworks don't bundle env at build time — use bare names with
  // no VITE_ / NEXT_PUBLIC_ prefix so they work in dotenv or cloud secret
  // managers directly.
  if (SERVER_FRAMEWORK_IDS.has(framework.id)) {
    return [
      `MUSHI_PROJECT_ID=${projectId}`,
      `MUSHI_API_KEY=${apiKey}`,
      endpointLine,
    ].filter(Boolean).join('\n')
  }
  // React Native bare workflow + Remix: bare MUSHI_* names. RN reads them via
  // dotenv/babel; Remix exposes the public values to the client at runtime via
  // the root loader + window.ENV (it does not inline a prefixed build-time var).
  if (framework.id === 'react-native' || framework.id === 'remix') {
    return [
      `MUSHI_PROJECT_ID=${projectId}`,
      `MUSHI_API_KEY=${apiKey}`,
      endpointLine,
    ].filter(Boolean).join('\n')
  }
  // Expo managed workflow: EXPO_PUBLIC_ prefix is required for JS access
  if (framework.id === 'expo') {
    return [
      `EXPO_PUBLIC_MUSHI_PROJECT_ID=${projectId}`,
      `EXPO_PUBLIC_MUSHI_API_KEY=${apiKey}`,
      endpointLine ? `EXPO_PUBLIC_${endpointLine}` : null,
    ].filter(Boolean).join('\n')
  }
  // Build-time inlined client env. CRA only exposes REACT_APP_*; Astro only
  // exposes PUBLIC_* (Vite); Next/Nuxt use their framework prefixes; everything
  // else Vite-based (React, Vue, Svelte(Kit), Angular, Capacitor, Solid,
  // vanilla) uses VITE_.
  const prefix =
    framework.id === 'next' ? 'NEXT_PUBLIC_'
    : framework.id === 'nuxt' ? 'NUXT_PUBLIC_'
    : framework.id === 'cra' ? 'REACT_APP_'
    : framework.id === 'astro' ? 'PUBLIC_'
    : 'VITE_'
  return [
    `${prefix}MUSHI_PROJECT_ID=${projectId}`,
    `${prefix}MUSHI_API_KEY=${apiKey}`,
    endpointLine ? `${prefix}${endpointLine}` : null,
  ].filter(Boolean).join('\n')
}

function collectDeps(pkg: PackageJson | null): Set<string> {
  if (!pkg) return new Set()
  return new Set([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
    ...Object.keys(pkg.peerDependencies ?? {}),
  ])
}
