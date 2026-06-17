/**
 * FILE: packages/core/src/env-config.ts
 * PURPOSE: Reads Mushi credentials from the environment when they are not
 *          supplied explicitly. This lets every framework init work with
 *          zero-config — just run `npx mushi-mushi` once, add the .env.local
 *          line, and the provider/plugin/init works without props.
 *
 * Resolution order per field:
 *   1. Vite / SvelteKit / Angular (VITE_MUSHI_*)
 *   2. Next.js (NEXT_PUBLIC_MUSHI_*)
 *   3. Nuxt (NUXT_PUBLIC_MUSHI_*)
 *   4. Expo managed workflow (EXPO_PUBLIC_MUSHI_*)
 *   5. Node / React Native / server (bare MUSHI_*)
 *
 * Vite statically replaces `import.meta.env.VITE_*` at build time, so the
 * literal key references here are intentional — they make bundlers replace
 * the values even when accessed indirectly.
 */

export interface ResolvedEnvConfig {
  projectId?: string;
  apiKey?: string;
  apiEndpoint?: string;
}

function first(...values: (string | undefined)[]): string | undefined {
  return values.find((v) => v !== undefined && v !== '');
}

function tryImportMetaEnv(key: string): string | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const env = (import.meta as any).env;
    return typeof env === 'object' && env !== null ? (env[key] as string | undefined) : undefined;
  } catch {
    return undefined;
  }
}

function tryProcessEnv(key: string): string | undefined {
  try {
    // Access via globalThis to avoid requiring @types/node in browser packages.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const proc = (globalThis as any).process;
    return proc && proc.env ? (proc.env[key] as string | undefined) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Reads Mushi projectId, apiKey, and (optionally) apiEndpoint from
 * the environment. Returns only the fields that are present so callers
 * can cleanly spread: `{ ...resolveEnvConfig(), ...explicitConfig }`.
 */
export function resolveEnvConfig(): ResolvedEnvConfig {
  const projectId = first(
    tryImportMetaEnv('VITE_MUSHI_PROJECT_ID'),
    tryImportMetaEnv('NEXT_PUBLIC_MUSHI_PROJECT_ID'),
    tryImportMetaEnv('NUXT_PUBLIC_MUSHI_PROJECT_ID'),
    tryImportMetaEnv('EXPO_PUBLIC_MUSHI_PROJECT_ID'),
    tryProcessEnv('NEXT_PUBLIC_MUSHI_PROJECT_ID'),
    tryProcessEnv('EXPO_PUBLIC_MUSHI_PROJECT_ID'),
    tryProcessEnv('MUSHI_PROJECT_ID'),
  );

  const apiKey = first(
    tryImportMetaEnv('VITE_MUSHI_API_KEY'),
    tryImportMetaEnv('NEXT_PUBLIC_MUSHI_API_KEY'),
    tryImportMetaEnv('NUXT_PUBLIC_MUSHI_API_KEY'),
    tryImportMetaEnv('EXPO_PUBLIC_MUSHI_API_KEY'),
    tryProcessEnv('NEXT_PUBLIC_MUSHI_API_KEY'),
    tryProcessEnv('EXPO_PUBLIC_MUSHI_API_KEY'),
    tryProcessEnv('MUSHI_API_KEY'),
  );

  const apiEndpoint = first(
    tryImportMetaEnv('VITE_MUSHI_API_ENDPOINT'),
    tryImportMetaEnv('NEXT_PUBLIC_MUSHI_API_ENDPOINT'),
    tryProcessEnv('NEXT_PUBLIC_MUSHI_API_ENDPOINT'),
    tryProcessEnv('MUSHI_API_ENDPOINT'),
  );

  const result: ResolvedEnvConfig = {};
  if (projectId) result.projectId = projectId;
  if (apiKey) result.apiKey = apiKey;
  if (apiEndpoint) result.apiEndpoint = apiEndpoint;
  return result;
}
