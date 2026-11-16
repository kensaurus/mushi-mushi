/**
 * FILE: apps/admin/src/lib/sentrySourcemaps.ts
 * PURPOSE: The sourcemap delete glob passed to @sentry/vite-plugin.
 *
 * The plugin deletes with glob (absolute, nodir). The pattern is absolute so
 * it does not depend on the process cwd. Vite's build dir is `dist`.
 */

/** Globs for `sourcemaps.filesToDeleteAfterUpload`. Forward slashes only. */
export function sentrySourcemapDeleteGlobs(distDir: string): string[] {
  return [`${distDir.replace(/\\/g, '/')}/**/*.map`]
}

/**
 * Patterns the Vite plugin passes to glob when `output.dir` is set
 * (`writeBundle` in @sentry/bundler-plugins 5.3 and 11.11). The `?(\?*)?(#*)`
 * suffix is the plugin's own, so query or hash suffixes still match.
 */
export const SENTRY_VITE_UPLOAD_GLOBS = [
  '/**/*.js',
  '/**/*.mjs',
  '/**/*.cjs',
  '/**/*.js.map',
  '/**/*.mjs.map',
  '/**/*.cjs.map',
].map((pattern) => `${pattern}?(\\?*)?(#*)`)
