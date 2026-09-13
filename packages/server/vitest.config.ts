import { defineConfig } from 'vitest/config'
import path from 'node:path'

const STUB = path.resolve(__dirname, 'src/__tests__/__stubs__/npm-stub.ts')

/**
 * The Edge Function source uses Deno-style `npm:` specifiers (e.g.
 * `import { z } from 'npm:zod@3'` or
 * `import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'`). Vitest
 * runs on Node and resolves bare specifiers from `node_modules`, so any test
 * that transitively imports an Edge Function source file would otherwise blow
 * up at transform time.
 *
 * Real call sites in tests are always replaced with `vi.mock(...)` so the
 * runtime never reaches these modules. We only need to satisfy Vite's
 * transform-time resolver — point everything at a permissive stub.
 *
 * Exception: `npm:zod@3` is a real value-level import in `_shared/fix-schema.ts`
 * and `_shared/schemas.ts` and the corresponding tests assert on Zod's
 * behaviour, so it gets mapped to the actually-installed `zod` package.
 */
const npmStubResolver = {
  name: 'mushi-mushi-npm-specifier-stub',
  enforce: 'pre' as const,
  resolveId(id: string) {
    if (!id.startsWith('npm:')) return null
    if (id === 'npm:zod@3') return null // handled by alias below
    if (id === 'npm:yaml@2') return null // handled by alias below
    return STUB
  },
}

export default defineConfig({
  plugins: [npmStubResolver],
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Vitest defaults to 5s per test. Every test in this package is a pure
    // unit test against stubs — 45 of them run in 3.7s when the package runs
    // alone, about 80ms each. But `turbo run test` starts a vitest instance
    // per workspace, and on a loaded machine individual tests were measured at
    // 6–8s of wall clock purely from CPU starvation, tripping the 5s default:
    // agent-status-poll, dispatch-fix, linear-agent-dispatch and web-push all
    // failed that way while passing in isolation. 30s is far above anything
    // this suite legitimately needs, so a genuinely hung test still fails —
    // it just stops reporting scheduler contention as a test failure.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    alias: {
      'npm:zod@3': 'zod',
      // The inventory v2 helper uses `npm:yaml@2` to parse customer
      // inventory.yaml. The Node-side test runs against the actually
      // installed `yaml` package so the parser behaves identically.
      'npm:yaml@2': 'yaml',
    },
  },
})
