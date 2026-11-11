/**
 * FILE: apps/admin/src/lib/sdkInstallDefaults.ts
 * PURPOSE: Resolve the default SdkInstallCard framework tab from project slug
 *          and optional linked-repo package.json (frameworkDetect).
 */

import { detectFromPackageJson } from './frameworkDetect'
import { isExpoReporterProject } from './projectMushiEnv'
import type { Framework } from './sdkSnippets'

const MOBILE_FRAMEWORKS = new Set<Framework>(['react-native', 'expo', 'capacitor'])

/**
 * Pick the initial framework tab for SDK install snippets.
 * Slug wins for known Expo reporter projects; otherwise high-confidence
 * detection from package.json (expo / react-native / capacitor).
 */
/** The web bundler a package.json declares, for env-var snippets. */
export function detectWebBundler(packageJsonText: string | null | undefined): 'vite' | 'next' | null {
  if (!packageJsonText?.trim()) return null
  try {
    const pkg = JSON.parse(packageJsonText) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }
    const deps = { ...pkg.dependencies, ...pkg.devDependencies }
    if ('next' in deps) return 'next'
    if ('vite' in deps) return 'vite'
  } catch { /* not JSON: no bundler */ }
  return null
}

export function resolveDefaultSdkFramework(
  slug: string | null | undefined,
  packageJsonText?: string | null,
): Framework {
  if (isExpoReporterProject(slug)) return 'expo'

  if (packageJsonText?.trim()) {
    const detected = detectFromPackageJson(packageJsonText)
    // A confident read of the app's own package.json picks its tab (React,
    // Vue, Svelte, mobile…). `vanilla` is the detector's "unknown", so the
    // default below stays for it.
    if (detected.confidence >= 0.8 && (MOBILE_FRAMEWORKS.has(detected.framework) || detected.framework !== 'vanilla')) {
      return detected.framework
    }
  }

  // Unknown stack: the Script tag (console audit 2026-11-11). It works on
  // every web host with no build step, and it is the Lovable / Bolt path
  // (ADR 0056 lists it first). The React default with an inlined key was the
  // first thing a Lovable owner saw, with no word on where it goes.
  return 'loader'
}
