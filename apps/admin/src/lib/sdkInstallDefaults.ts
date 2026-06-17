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
export function resolveDefaultSdkFramework(
  slug: string | null | undefined,
  packageJsonText?: string | null,
): Framework {
  if (isExpoReporterProject(slug)) return 'expo'

  if (packageJsonText?.trim()) {
    const detected = detectFromPackageJson(packageJsonText)
    if (detected.confidence >= 0.8 && MOBILE_FRAMEWORKS.has(detected.framework)) {
      return detected.framework
    }
  }

  return 'react'
}
