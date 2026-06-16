/**
 * API-key project scoping tests for adminOrApiKey routes.
 * Run: cd packages/server && deno test supabase/functions/api/__tests__/api-key-scope.test.ts
 */

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

// Pure helpers mirrored from shared.ts — keep in sync with callerProjectIds logic.
function callerProjectIdsFromContext(
  authMethod: 'jwt' | 'apiKey' | undefined,
  boundProjectId: string | undefined,
  requestedProjectId: string | null,
  ownedIds: string[],
): string[] {
  if (authMethod === 'apiKey') {
    if (!boundProjectId) return []
    if (requestedProjectId && requestedProjectId !== boundProjectId) return []
    return [boundProjectId]
  }
  if (!requestedProjectId) return ownedIds
  return ownedIds.includes(requestedProjectId) ? [requestedProjectId] : []
}

Deno.test('api key returns only bound project', () => {
  const ids = callerProjectIdsFromContext('apiKey', 'project-a', null, ['project-a', 'project-b'])
  assertEquals(ids, ['project-a'])
})

Deno.test('api key rejects mismatched project_id query', () => {
  const ids = callerProjectIdsFromContext('apiKey', 'project-a', 'project-b', ['project-a', 'project-b'])
  assertEquals(ids, [])
})

Deno.test('jwt admin sees all owned projects without header', () => {
  const ids = callerProjectIdsFromContext('jwt', undefined, null, ['project-a', 'project-b'])
  assertEquals(ids, ['project-a', 'project-b'])
})

Deno.test('jwt admin honours project header when owned', () => {
  const ids = callerProjectIdsFromContext('jwt', undefined, 'project-b', ['project-a', 'project-b'])
  assertEquals(ids, ['project-b'])
})

Deno.test('jwt admin returns empty for foreign project header', () => {
  const ids = callerProjectIdsFromContext('jwt', undefined, 'project-c', ['project-a', 'project-b'])
  assertEquals(ids, [])
})
