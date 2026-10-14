/**
 * FILE: repo-stack.ts
 * PURPOSE: Read a repo's bundler (Expo, Vite, Next.js) from its package.json
 *          files at the default-branch head, so the Mushi env names a check
 *          expects, or that CI-secret sync writes, are the ones the app's
 *          bundler really inlines (EXPO_PUBLIC_, VITE_, NEXT_PUBLIC_).
 *
 * Shared by the recipe env check (api/routes/recipe.ts) and the CI-secret
 * diagnostic and sync (api/routes/project-ci-secrets.ts).
 */

import { getDefaultHead, readRepoFile, type RecipeRepo } from './recipe-github.ts'
import { STACK_PACKAGE_PATHS, stackFromPackageJsons, type SdkStack } from './sdk-diagnostics.ts'

/**
 * The repo's stack, or null when no package.json names a known bundler.
 * A file that cannot be read is skipped. When every read failed nothing was
 * learned, so it throws: callers fall back to the slug and must not cache it.
 */
export async function detectRepoStack(repo: RecipeRepo): Promise<SdkStack | null> {
  const head = await getDefaultHead(repo)
  const reads = await Promise.allSettled(STACK_PACKAGE_PATHS.map((p) => readRepoFile(repo, head.sha, p, 512 * 1024)))
  if (reads.every((r) => r.status === 'rejected')) throw new Error('No package.json could be read')
  return stackFromPackageJsons(reads.flatMap((r) => (r.status === 'fulfilled' && r.value.kind === 'file' ? [r.value.text] : [])))
}
