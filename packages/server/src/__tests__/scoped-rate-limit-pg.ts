/**
 * The multi-connection rate-limit probe needs a real Postgres, so it stays
 * out of the ordinary suite unless MUSHI_SERVER_PG_INTEGRATION=1
 * (`pnpm --filter @mushi-mushi/server test:integration`).
 * The image is one pinned reference, never a cached name that merely
 * contains "postgres".
 */

export const PG_INTEGRATION_GLOB = 'src/**/*.integration.test.ts'

/** Official library image. Tag is exact; a cache search must not widen it. */
export const POSTGRES_IMAGE = 'postgres:17-alpine'

type FlagEnv = { readonly MUSHI_SERVER_PG_INTEGRATION?: string | undefined }

export function pgIntegrationEnabled(env: FlagEnv): boolean {
  return env.MUSHI_SERVER_PG_INTEGRATION === '1'
}

export function pgIntegrationExclude(env: FlagEnv): string[] {
  return pgIntegrationEnabled(env) ? [] : [PG_INTEGRATION_GLOB]
}

/**
 * Always the pinned image. `local` is true only when the cache has that
 * exact repository and tag, so an exporter or an older major cannot win
 * and `--pull never` is not pointed at the wrong image.
 */
export function resolvePostgresImage(cachedNames: readonly string[]): { image: string; local: boolean } {
  const local = cachedNames.some((name) => name.trim() === POSTGRES_IMAGE)
  return { image: POSTGRES_IMAGE, local }
}
