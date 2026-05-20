/**
 * FILE: apps/admin/src/lib/frameworkDetect.ts
 * PURPOSE: Zero-config framework + monorepo detection from a package.json
 *          string (or object). Works entirely client-side — the user pastes
 *          their package.json into the setup wizard and we auto-select the
 *          right SDK tab + install command, and surface monorepo workspace
 *          guidance when needed.
 *
 *          Design goals:
 *          - ELI5: always return a `confidence` explanation the UI can show
 *          - User-forgiving: unknown deps → 'vanilla' + helpful note
 *          - Monorepo-aware: detect workspaces / Nx / Turborepo / Lerna
 *          - Error-recovering: never throw; always return a usable result
 */

import type { Framework } from './sdkSnippets'

// ─── Types ────────────────────────────────────────────────────────────────────

export type DetectedMonorepo =
  | 'npm-workspaces'
  | 'yarn-workspaces'
  | 'pnpm-workspaces'
  | 'turborepo'
  | 'nx'
  | 'lerna'
  | 'rush'
  | null

export interface DetectionResult {
  /** Best-guess framework tab to select. Never null — defaults to 'react'. */
  framework: Framework
  /** 0–1 confidence. ≥0.8 = auto-select without asking; <0.5 = ask user. */
  confidence: number
  /** Plain-English explanation suitable for a tooltip / "Why?" expandable. */
  reason: string
  /** Monorepo tool detected (or null if this is a flat repo). */
  monorepo: DetectedMonorepo
  /** Suggested install path for monorepo repos (e.g. "apps/web" workspace). */
  workspacePath: string | null
  /** If we detected multiple apps in a monorepo, the best-guess app entry. */
  workspaceHint: string | null
  /** Any relevant warnings (stale deps, missing peer deps, Hermes compat). */
  warnings: string[]
  /** True when the detected env is Hermes/RN and shake trigger needs update. */
  needsHermesTriggerFix: boolean
}

type PackageJson = {
  name?: string
  version?: string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  workspaces?: string[] | { packages?: string[] }
  scripts?: Record<string, string>
  private?: boolean
}

// ─── Detection rules ─────────────────────────────────────────────────────────

/** Returns true if the dep (or devDep) name matches a keyword. */
function hasDep(pkg: PackageJson, ...names: string[]): boolean {
  const all = {
    ...pkg.dependencies,
    ...pkg.devDependencies,
    ...pkg.peerDependencies,
  }
  return names.some((n) => n in all)
}

/** Get installed semver string for a dep, null if absent. */
function depVersion(pkg: PackageJson, name: string): string | null {
  return (
    pkg.dependencies?.[name] ??
    pkg.devDependencies?.[name] ??
    pkg.peerDependencies?.[name] ??
    null
  )
}

/** Parse the major version from a semver range like "^0.8.1" → 0 */
function majorVersion(range: string | null): number {
  if (!range) return 0
  const m = range.replace(/[\^~>=<]/g, '').match(/^(\d+)/)
  return m ? parseInt(m[1], 10) : 0
}

/** Parse the minor version from a semver range like "^0.8.1" → 8 */
function minorVersion(range: string | null): number {
  if (!range) return 0
  const m = range.replace(/[\^~>=<]/g, '').match(/^\d+\.(\d+)/)
  return m ? parseInt(m[1], 10) : 0
}

/** Parse the patch version from a semver range like "^0.8.1" → 1 */
function patchVersion(range: string | null): number {
  if (!range) return 0
  const m = range.replace(/[\^~>=<]/g, '').match(/^\d+\.\d+\.(\d+)/)
  return m ? parseInt(m[1], 10) : 0
}

function detectMonorepo(pkg: PackageJson): DetectedMonorepo {
  if (
    pkg.workspaces !== undefined &&
    (Array.isArray(pkg.workspaces) || typeof pkg.workspaces === 'object')
  ) {
    // Distinguish npm/yarn vs pnpm via package manager field or lockfile presence.
    // We can't read the filesystem, so we use heuristics on the scripts.
    const scripts = pkg.scripts ?? {}
    const scriptText = Object.values(scripts).join(' ')
    if (scriptText.includes('pnpm')) return 'pnpm-workspaces'
    return 'npm-workspaces'
  }
  if (hasDep(pkg, 'lerna')) return 'lerna'
  if (hasDep(pkg, 'turbo', 'turborepo')) return 'turborepo'
  if (hasDep(pkg, 'nx', '@nrwl/workspace', '@nx/workspace')) return 'nx'
  if (hasDep(pkg, '@microsoft/rush-lib')) return 'rush'
  return null
}

function detectWorkspacePath(pkg: PackageJson, monorepo: DetectedMonorepo): string | null {
  if (!monorepo) return null
  const ws = pkg.workspaces
  if (Array.isArray(ws) && ws.length > 0) {
    // "apps/*" → "apps/web" is a common guess; we show the pattern.
    return ws[0]
  }
  if (ws && typeof ws === 'object' && 'packages' in ws && Array.isArray(ws.packages)) {
    return ws.packages[0] ?? null
  }
  return null
}

// ─── Main detector ────────────────────────────────────────────────────────────

/**
 * Detect the framework, monorepo type, and install guidance from a
 * raw package.json string or object.
 *
 * Never throws. Returns a `DetectionResult` even on garbage input.
 */
export function detectFromPackageJson(input: string | PackageJson): DetectionResult {
  const warnings: string[] = []

  // Parse
  let pkg: PackageJson
  try {
    pkg = typeof input === 'string' ? (JSON.parse(input) as PackageJson) : input
  } catch {
    return {
      framework: 'react',
      confidence: 0.1,
      reason: "Couldn't parse the JSON — double-check for trailing commas or missing brackets.",
      monorepo: null,
      workspacePath: null,
      workspaceHint: null,
      warnings: ['JSON parse error — check for typos.'],
      needsHermesTriggerFix: false,
    }
  }

  const monorepo = detectMonorepo(pkg)
  const workspacePath = detectWorkspacePath(pkg, monorepo)

  // Root package.json of a monorepo typically has no framework deps — guide user
  // to paste the app-level package.json instead.
  const isMonorepoRoot =
    monorepo !== null &&
    !hasDep(pkg, 'react', 'vue', 'svelte', 'react-native', '@capacitor/core', 'expo')
  if (isMonorepoRoot) {
    return {
      framework: 'react',
      confidence: 0.2,
      reason:
        "This looks like a monorepo root — it has workspace config but no framework deps. " +
        "Paste the package.json from the app you want to instrument (e.g. `" +
        (workspacePath ?? 'apps/web') +
        "/package.json`) for a more accurate result.",
      monorepo,
      workspacePath,
      workspaceHint: workspacePath ?? null,
      warnings: [
        'Detected monorepo root. Install the SDK in your app workspace, not the root.',
      ],
      needsHermesTriggerFix: false,
    }
  }

  // ── Framework scoring ──────────────────────────────────────────────────────

  // React Native / Expo
  if (hasDep(pkg, 'react-native')) {
    const rnMushiVersion = depVersion(pkg, '@mushi-mushi/react-native')
    const isOldVersion =
      rnMushiVersion !== null &&
      majorVersion(rnMushiVersion) === 0 &&
      minorVersion(rnMushiVersion) <= 8

    const needsHermesTriggerFix = isOldVersion

    if (isOldVersion) {
      warnings.push(
        `@mushi-mushi/react-native ${rnMushiVersion} has a Hermes compatibility bug — ` +
          'upgrade to ^0.10.1 and change widget.trigger from "manual" to "button".',
      )
    }

    if (hasDep(pkg, 'expo')) {
      return {
        framework: 'expo',
        confidence: 0.95,
        reason: 'Found expo + react-native → Expo framework.',
        monorepo,
        workspacePath,
        workspaceHint: workspacePath,
        warnings,
        needsHermesTriggerFix,
      }
    }

    return {
      framework: 'react-native',
      confidence: 0.95,
      reason: 'Found react-native → bare React Native.',
      monorepo,
      workspacePath,
      workspaceHint: workspacePath,
      warnings,
      needsHermesTriggerFix,
    }
  }

  // Capacitor
  if (hasDep(pkg, '@capacitor/core')) {
    return {
      framework: 'capacitor',
      confidence: 0.93,
      reason: 'Found @capacitor/core → Capacitor hybrid app.',
      monorepo,
      workspacePath,
      workspaceHint: workspacePath,
      warnings,
      needsHermesTriggerFix: false,
    }
  }

  // Svelte / SvelteKit
  if (hasDep(pkg, 'svelte', '@sveltejs/kit')) {
    return {
      framework: 'svelte',
      confidence: 0.92,
      reason: 'Found svelte → Svelte / SvelteKit.',
      monorepo,
      workspacePath,
      workspaceHint: workspacePath,
      warnings,
      needsHermesTriggerFix: false,
    }
  }

  // Vue / Nuxt
  if (hasDep(pkg, 'vue', 'nuxt', '@nuxtjs/core')) {
    return {
      framework: 'vue',
      confidence: 0.92,
      reason: 'Found vue → Vue / Nuxt.',
      monorepo,
      workspacePath,
      workspaceHint: workspacePath,
      warnings,
      needsHermesTriggerFix: false,
    }
  }

  // React (Next.js, Remix, Vite React, CRA, etc.)
  if (hasDep(pkg, 'react', 'next', 'remix', 'gatsby', '@remix-run/react')) {
    // Distinguish React + TS (common) from bare React for hint copy
    const isNextJs = hasDep(pkg, 'next')
    const isRemix = hasDep(pkg, '@remix-run/react', 'remix')
    const reason = isNextJs
      ? 'Found next + react → Next.js app.'
      : isRemix
        ? 'Found @remix-run/react → Remix app.'
        : 'Found react → React app.'

    // Check if they already have the SDK installed (old version warning)
    const existing = depVersion(pkg, '@mushi-mushi/react')
    if (existing) {
      const maj = majorVersion(existing)
      if (maj < 1) {
        warnings.push(
          `@mushi-mushi/react ${existing} is pre-1.0 — consider upgrading to the latest stable.`,
        )
      }
    }

    return {
      framework: 'react',
      confidence: 0.9,
      reason,
      monorepo,
      workspacePath,
      workspaceHint: workspacePath,
      warnings,
      needsHermesTriggerFix: false,
    }
  }

  // Angular — not yet a Mushi adapter, but we can suggest vanilla
  if (hasDep(pkg, '@angular/core')) {
    warnings.push(
      'Angular detected. Use the Vanilla JS tab — paste the snippet into your AppModule bootstrap.',
    )
    return {
      framework: 'vanilla',
      confidence: 0.7,
      reason:
        'Found @angular/core → Angular app. No dedicated adapter yet — use the Vanilla JS tab.',
      monorepo,
      workspacePath,
      workspaceHint: workspacePath,
      warnings,
      needsHermesTriggerFix: false,
    }
  }

  // Fallback — could be vanilla JS, Astro, Qwik, etc.
  warnings.push(
    "Couldn't identify a known framework. The Vanilla JS tab works for any HTML page. " +
      "If you use Astro, Qwik, or another framework, paste the init snippet into your root layout.",
  )
  return {
    framework: 'vanilla',
    confidence: 0.4,
    reason:
      "No known framework detected. Defaulting to Vanilla JS — works for any HTML page.",
    monorepo,
    workspacePath,
    workspaceHint: workspacePath,
    warnings,
    needsHermesTriggerFix: false,
  }
}

// ─── Monorepo install guidance ─────────────────────────────────────────────────

/**
 * Human-readable install guidance for a monorepo setup.
 * Returns null for flat (non-monorepo) repos.
 */
export function monorepoInstallGuidance(
  result: DetectionResult,
  installCmd: string,
): string | null {
  if (!result.monorepo) return null

  const toolLabel: Record<NonNullable<DetectedMonorepo>, string> = {
    'npm-workspaces': 'npm workspaces',
    'yarn-workspaces': 'Yarn workspaces',
    'pnpm-workspaces': 'pnpm workspaces',
    turborepo: 'Turborepo',
    nx: 'Nx',
    lerna: 'Lerna',
    rush: 'Rush',
  }

  const tool = toolLabel[result.monorepo]
  const appPath = result.workspaceHint ?? 'your app workspace'

  const runIn = result.monorepo === 'npm-workspaces'
    ? `npm install --workspace=${appPath} @mushi-mushi/...`
    : result.monorepo === 'pnpm-workspaces'
      ? `pnpm add --filter ${appPath} @mushi-mushi/...`
      : result.monorepo === 'yarn-workspaces'
        ? `yarn workspace ${appPath} add @mushi-mushi/...`
        : installCmd

  return (
    `Detected ${tool} monorepo. Run the install inside your app's workspace — not the root:\n\n` +
    `  ${runIn}\n\n` +
    `Then add the provider to ${appPath}'s entry file.`
  )
}

// ─── ELI5 step builder ────────────────────────────────────────────────────────

export interface SetupStep {
  id: string
  title: string
  body: string
  code?: string
  actionLabel?: string
  actionHref?: string
  done?: boolean
}

/**
 * Build an ELI5 step list for a first-time integrator based on the
 * detection result and their project.
 */
export function buildSetupSteps(
  result: DetectionResult,
  projectId: string,
  apiKey: string | null | undefined,
): SetupStep[] {
  const fw = result.framework
  const isMobile = fw === 'react-native' || fw === 'expo' || fw === 'capacitor'

  const steps: SetupStep[] = []

  // Step 1: Install the package
  const pkg =
    fw === 'react' ? '@mushi-mushi/react'
    : fw === 'vue' ? '@mushi-mushi/vue @mushi-mushi/web'
    : fw === 'svelte' ? '@mushi-mushi/svelte @mushi-mushi/web'
    : fw === 'react-native' ? '@mushi-mushi/react-native'
    : fw === 'expo' ? '@mushi-mushi/react-native expo-sensors'
    : fw === 'capacitor' ? '@mushi-mushi/capacitor'
    : '@mushi-mushi/web'

  const installCmd =
    fw === 'expo'
      ? `npx expo install @mushi-mushi/react-native expo-sensors`
      : fw === 'capacitor'
        ? `npm install @mushi-mushi/capacitor && npx cap sync`
        : `npm install ${pkg}`

  steps.push({
    id: 'install',
    title: '1. Install the SDK',
    body: result.monorepo
      ? `You're in a ${result.monorepo} monorepo. Run this inside your app workspace (not the root).`
      : 'Run this in your project folder.',
    code: installCmd,
    actionLabel: 'Copy',
    done: false,
  })

  // Step 2: Get your API key
  steps.push({
    id: 'api-key',
    title: '2. Get your API key',
    body: apiKey
      ? 'Your key is shown below — it was just generated. Copy it now; it won\'t be shown again.'
      : 'Go to Projects, select your project, choose "SDK" from the scope dropdown, and click the key icon.',
    actionLabel: apiKey ? 'Copy key' : 'Open Projects →',
    actionHref: apiKey ? undefined : '/projects',
    done: Boolean(apiKey),
  })

  // Step 3: Add the provider
  steps.push({
    id: 'add-provider',
    title: isMobile ? '3. Wrap your app with MushiProvider' : '3. Initialise Mushi',
    body: isMobile
      ? `Wrap your root component (in App.tsx) with <MushiProvider projectId="…" apiKey="…">. ` +
        `The snippet tab on the right has the full code — copy and paste.`
      : `Call Mushi.init() once when your app loads. The snippet tab shows the exact call. ` +
        `For Next.js, put it in app/layout.tsx. For Vite, put it in main.tsx.`,
    code: isMobile
      ? `import { MushiProvider } from '@mushi-mushi/react-native'\n\nexport default function App() {\n  return (\n    <MushiProvider projectId="${projectId}" apiKey="${apiKey ?? 'your-api-key'}">\n      <YourApp />\n    </MushiProvider>\n  )\n}`
      : undefined,
    done: false,
  })

  // Step 4: Send a test report
  steps.push({
    id: 'test-report',
    title: '4. Send a test report',
    body: isMobile
      ? 'Run the app — you should see a floating 🐛 button. Tap it, fill in the description, and submit. The report will appear in Inbox within seconds.'
      : 'After init, a 🐛 button appears in the corner of your browser. Click it, describe a fake bug, and submit. Check Inbox in the admin to confirm it arrived.',
    done: false,
  })

  // Step 5 for mobile: verify env vars exist
  if (isMobile) {
    steps.push({
      id: 'env-vars',
      title: '5. Add env vars to your .env file',
      body:
        `The SDK reads its credentials from env vars at build time. Add these to \`apps/mobile/.env\`:`,
      code: `GLOTIT_MUSHI_PROJECT_ID=${projectId}\nGLOTIT_MUSHI_API_KEY=${apiKey ?? 'paste-key-here'}`,
      done: Boolean(apiKey),
    })
  }

  return steps
}
