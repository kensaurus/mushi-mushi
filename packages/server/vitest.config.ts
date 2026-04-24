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
    return STUB
  },
}

export default defineConfig({
  plugins: [npmStubResolver],
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    alias: {
      'npm:zod@3': 'zod',
    },
  },
})
