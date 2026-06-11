/**
 * FILE: apps/admin/src/lib/projectMushiEnv.ts
 * PURPOSE: Map a project's slug to the env-var names its real codebase uses.
 *          Diagnostics and copy snippets previously hard-coded
 *          NEXT_PUBLIC_MUSHI_* everywhere, which misled Expo (yen-yen),
 *          Vite admin dogfood (mushi-mushi), and Vite SPA (solo-boss-cloud)
 *          integrators during setup.
 */

export interface ProjectMushiEnvVars {
  projectIdVar: string
  apiKeyVar: string
  endpointVar?: string
  /** Where operators typically paste credentials for this stack. */
  envFileHint?: string
  stackLabel: string
}

const DEFAULT_WEB: ProjectMushiEnvVars = {
  projectIdVar: 'NEXT_PUBLIC_MUSHI_PROJECT_ID',
  apiKeyVar: 'NEXT_PUBLIC_MUSHI_API_KEY',
  endpointVar: 'NEXT_PUBLIC_MUSHI_API_ENDPOINT',
  stackLabel: 'Next.js / web',
}

function normalizeSlug(slug: string): string {
  return slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, '')
}

/** Resolve env-var naming for a project slug. Falls back to Next.js web vars. */
export function mushiEnvVarsForProjectSlug(slug: string | null | undefined): ProjectMushiEnvVars {
  const s = normalizeSlug(slug ?? '')
  if (s === 'mushi-mushi' || s === 'mushimushi') {
    return {
      projectIdVar: 'VITE_MUSHI_SELF_PROJECT_ID',
      apiKeyVar: 'VITE_MUSHI_SELF_API_KEY',
      endpointVar: 'VITE_MUSHI_SELF_API_ENDPOINT',
      envFileHint: 'apps/admin/.env.local',
      stackLabel: 'Mushi admin console (Vite dogfood)',
    }
  }
  if (s === 'yen-yen' || s === 'yenyen') {
    return {
      projectIdVar: 'EXPO_PUBLIC_MUSHI_PROJECT_ID',
      apiKeyVar: 'EXPO_PUBLIC_MUSHI_API_KEY',
      envFileHint: 'apps/mobile/.env',
      stackLabel: 'Expo / React Native',
    }
  }
  if (s === 'solo-boss-cloud' || s === 'solobosscloud') {
    return {
      projectIdVar: 'VITE_MUSHI_PROJECT_ID',
      apiKeyVar: 'VITE_MUSHI_API_KEY',
      endpointVar: 'VITE_MUSHI_ENDPOINT',
      envFileHint: '.env.local',
      stackLabel: 'Vite SPA (solo-boss-cloud-documentation)',
    }
  }
  if (s === 'glot-it' || s === 'glotit') {
    return DEFAULT_WEB
  }
  return DEFAULT_WEB
}

export function formatEnvVarPair(env: ProjectMushiEnvVars): string {
  return `${env.projectIdVar} / ${env.apiKeyVar}`
}
