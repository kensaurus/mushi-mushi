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

type DetectedMonorepo =
  | 'npm-workspaces'
  | 'yarn-workspaces'
  | 'pnpm-workspaces'
  | 'turborepo'
  | 'nx'
  | 'lerna'
  | 'rush'
  | null

export interface DetectionResult {
  /** Best-guess framework tab to select. Never null. Defaults to 'vanilla' for
   *  unknown deps / Angular. Returns 'react' on JSON parse errors (invalid input)
   *  and for monorepo roots (no framework deps detected at root level, low
   *  confidence). Callers should check `confidence` before acting on this value. */
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
  /** corepack-managed field: "pnpm@9.1.0", "yarn@4.1.0", etc. */
  packageManager?: string
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

/**
 * Normalise a dependency version range to a plain semver before parsing.
 * Handles workspace: prefixes (workspace:^, workspace:*, workspace:~),
 * npm: aliases (npm:foo@^1.2.3), and regular semver operators (^, ~, >=).
 */
function normaliseSemver(range: string | null): string {
  if (!range) return ''
  // Strip workspace: prefix (workspace:^1.2, workspace:*, etc.)
  let v = range.replace(/^workspace:/, '')
  // Strip npm: alias prefix — "npm:pkg@^1.2" → "^1.2"
  v = v.replace(/^npm:[^@]+@/, '')
  // Strip remaining semver operators
  v = v.replace(/[\^~>=<\s]/g, '')
  return v
}

/** Parse the major version from a semver range like "^0.8.1" → 0 */
function majorVersion(range: string | null): number {
  const v = normaliseSemver(range)
  const m = v.match(/^(\d+)/)
  return m ? parseInt(m[1], 10) : 0
}

/** Parse the minor version from a semver range like "^0.8.1" → 8 */
function minorVersion(range: string | null): number {
  const v = normaliseSemver(range)
  const m = v.match(/^\d+\.(\d+)/)
  return m ? parseInt(m[1], 10) : 0
}


function detectMonorepo(pkg: PackageJson): DetectedMonorepo {
  if (
    pkg.workspaces !== undefined &&
    (Array.isArray(pkg.workspaces) || typeof pkg.workspaces === 'object')
  ) {
    // Use packageManager field first (most reliable — set by corepack)
    const pm = pkg.packageManager ?? ''
    if (pm.startsWith('pnpm')) return 'pnpm-workspaces'
    if (pm.startsWith('yarn')) return 'yarn-workspaces'
    // Fall back to script heuristics
    const scripts = pkg.scripts ?? {}
    const scriptText = Object.values(scripts).join(' ')
    if (scriptText.includes('pnpm')) return 'pnpm-workspaces'
    if (scriptText.includes('yarn')) return 'yarn-workspaces'
    return 'npm-workspaces'
  }
  if (hasDep(pkg, 'lerna')) return 'lerna'
  if (hasDep(pkg, 'turbo', 'turborepo')) return 'turborepo'
  if (hasDep(pkg, 'nx', '@nrwl/workspace', '@nx/workspace')) return 'nx'
  if (hasDep(pkg, '@microsoft/rush-lib')) return 'rush'
  return null
}

/**
 * Resolve a raw workspace entry to a concrete path hint.
 * Glob patterns like "apps/*" are stripped to their base ("apps") and a
 * placeholder suffix is appended so the hint is usable in commands while
 * still signalling that the user should replace it with their actual path.
 */
function resolveWorkspaceEntry(entry: string): string {
  // Strip glob suffixes: apps/* → apps, packages/**/src → packages
  const stripped = entry.replace(/\/\*.*$/, '')
  // If the entry was a glob, append a <name> placeholder so the user knows
  // they need to substitute a real workspace directory.
  // Use a shell-safe placeholder (no angle brackets, no spaces) so copy-pasted
  // commands don't fail due to shell redirection operators.
  return entry.includes('*') ? `${stripped}/your-app` : stripped
}

function detectWorkspacePath(pkg: PackageJson, monorepo: DetectedMonorepo): string | null {
  if (!monorepo) return null
  const ws = pkg.workspaces
  if (Array.isArray(ws) && ws.length > 0) {
    return resolveWorkspaceEntry(ws[0])
  }
  if (ws && typeof ws === 'object' && 'packages' in ws && Array.isArray(ws.packages)) {
    const first = ws.packages[0]
    return first ? resolveWorkspaceEntry(first) : null
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
    // Hermes compat fix ships in 0.11.0 — all 0.x.y where minor < 11 are affected.
    const isOldVersion =
      rnMushiVersion !== null &&
      majorVersion(rnMushiVersion) === 0 &&
      minorVersion(rnMushiVersion) < 11

    const needsHermesTriggerFix = isOldVersion

    if (isOldVersion) {
      warnings.push(
        `@mushi-mushi/react-native ${rnMushiVersion} has a Hermes compatibility bug — ` +
          'upgrade to ^0.11.0 and change widget.trigger from "manual" to "button".',
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

  // Angular — @mushi-mushi/angular ships with provideMushi(); use the Vanilla
  // tab for the snippet (no dedicated tab yet) but guide users to the right pkg.
  if (hasDep(pkg, '@angular/core')) {
    warnings.push(
      'Angular detected. Install @mushi-mushi/angular, then add ' +
      'provideMushi({ projectId, apiKey }) to your app.config.ts providers array.',
    )
    return {
      framework: 'vanilla',
      confidence: 0.75,
      reason:
        'Found @angular/core → Angular app. Install @mushi-mushi/angular and use ' +
        'provideMushi() in app.config.ts. The Vanilla JS tab shows the raw init call ' +
        'as a fallback if needed.',
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
