/**
 * FILE: apps/admin/src/lib/platformReleaseProfile.ts
 * PURPOSE: Platform-aware release profile for SDK upgrade jobs.
 *          Determines what "deployed" means for different project types
 *          so the release cockpit can surface accurate deploy hints and
 *          decide whether to poll GitHub Deployments.
 */

export type PlatformType = 'web' | 'capacitor' | 'react-native' | 'static' | 'unknown'

export interface ReleaseProfile {
  /** Human-readable platform label */
  label: string
  /** After merging, does deployment happen automatically via GitHub Actions? */
  autoDeployOnMerge: boolean
  /** Should we poll GitHub Deployments for deploy status? */
  trackGithubDeployments: boolean
  /** Typical deploy time estimate in seconds (for progress UX) */
  estimatedDeploySeconds: number
  /** Help text shown in the release cockpit */
  deployHint: string
}

const PROFILES: Record<PlatformType, ReleaseProfile> = {
  web: {
    label: 'Web App',
    autoDeployOnMerge: true,
    trackGithubDeployments: true,
    estimatedDeploySeconds: 120,
    deployHint: 'Merging triggers CI → production deploy automatically.',
  },
  capacitor: {
    label: 'Capacitor (iOS/Android)',
    autoDeployOnMerge: true,
    trackGithubDeployments: false,
    estimatedDeploySeconds: 600,
    deployHint: 'Merging triggers a CI build that uploads to TestFlight and Play Store.',
  },
  'react-native': {
    label: 'React Native',
    autoDeployOnMerge: true,
    trackGithubDeployments: false,
    estimatedDeploySeconds: 900,
    deployHint: 'Merging triggers a CI build. Check Fastlane / EAS build logs for status.',
  },
  static: {
    label: 'Static / Docs',
    autoDeployOnMerge: true,
    trackGithubDeployments: true,
    estimatedDeploySeconds: 60,
    deployHint: 'Merging triggers a static site publish.',
  },
  unknown: {
    label: 'Unknown',
    autoDeployOnMerge: false,
    trackGithubDeployments: false,
    estimatedDeploySeconds: 300,
    deployHint: 'Merge the PR manually and verify deployment on your own.',
  },
}

/**
 * Detect platform type from project metadata.
 * Heuristic based on slug, repo name, or known project slugs.
 */
export function detectPlatformType(opts: {
  projectSlug?: string | null
  repoName?: string | null
}): PlatformType {
  const slug = (opts.projectSlug ?? '').toLowerCase()
  const repo = (opts.repoName ?? '').toLowerCase()
  const combined = `${slug} ${repo}`

  // Known specific slugs take priority over heuristics
  if (slug === 'glot-it' || slug === 'glotit') return 'capacitor'
  if (slug === 'yen-yen') return 'react-native'
  if (slug === 'mushi-mushi' || slug === 'mushi') return 'web'

  if (
    combined.includes('capacitor') ||
    combined.includes('ios') ||
    combined.includes('android') ||
    combined.includes('mobile')
  ) return 'capacitor'

  if (
    combined.includes('react-native') ||
    combined.includes('expo') ||
    combined.includes('rn-')
  ) return 'react-native'

  if (
    combined.includes('docs') ||
    combined.includes('landing') ||
    combined.includes('static')
  ) return 'static'

  if (
    combined.includes('web') ||
    combined.includes('app') ||
    combined.includes('dashboard') ||
    combined.includes('admin')
  ) return 'web'

  return 'unknown'
}

/**
 * Get the release profile for a project.
 */
export function getReleaseProfile(opts: {
  projectSlug?: string | null
  repoName?: string | null
}): ReleaseProfile {
  const platform = detectPlatformType(opts)
  return PROFILES[platform]
}
