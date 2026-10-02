/**
 * FILE: bundling/preserve-optional-requires.ts
 * PURPOSE: Build step (run from tsup.config.ts, not shipped): put literal
 *          `require("<module>")` back where esbuild's ESM output wrote its
 *          `__require("<module>")` interop shim.
 *
 * Metro only bundles a module it can see in a literal require; one handed to
 * the shim as a string was called through Metro's runtime require and crashed
 * the host app (0.21–0.23). The rewrite is limited to the optional native
 * peers loaded in ../optional-modules.ts, and the build fails when any other
 * `__require(` is left, so a new optional dependency can not slip back in.
 */

/** Optional native peers the SDK may load with a literal require. */
export const OPTIONAL_NATIVE_MODULES = [
  '@react-native-community/netinfo',
  'react-native-view-shot',
  'expo-sensors',
] as const

export interface PreserveResult {
  code: string
  rewritten: number
  /** Shim calls left over (each is a build error). */
  leftovers: string[]
}

export function preserveOptionalRequires(
  code: string,
  modules: readonly string[] = OPTIONAL_NATIVE_MODULES,
): PreserveResult {
  let rewritten = 0
  let out = code
  for (const name of modules) {
    for (const quote of ['"', "'"]) {
      const needle = `__require(${quote}${name}${quote})`
      const parts = out.split(needle)
      if (parts.length > 1) {
        rewritten += parts.length - 1
        out = parts.join(`require(${quote}${name}${quote})`)
      }
    }
  }
  const leftovers = [...out.matchAll(/__require\(([^)]{0,120})\)/g)].map((m) => m[0])
  // With no call left, esbuild's shim definition is dead code: drop it.
  if (leftovers.length === 0) {
    const start = out.indexOf('var __require = ')
    const end = start >= 0 ? out.indexOf('\n});\n', start) : -1
    if (start >= 0 && end > start) out = out.slice(0, start) + out.slice(end + '\n});\n'.length)
  }
  return { code: out, rewritten, leftovers }
}
