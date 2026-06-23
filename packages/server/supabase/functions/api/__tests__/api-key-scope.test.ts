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
  isOrgScopedKey = false,
): string[] {
  if (authMethod === 'apiKey') {
    if (isOrgScopedKey && !boundProjectId) {
      if (!requestedProjectId) return ownedIds
      return ownedIds.includes(requestedProjectId) ? [requestedProjectId] : []
    }
    if (!boundProjectId) return []
    if (requestedProjectId && requestedProjectId !== boundProjectId) return []
    return [boundProjectId]
  }
  if (!requestedProjectId) return ownedIds
  return ownedIds.includes(requestedProjectId) ? [requestedProjectId] : []
}

function canAccessReportProjectFromContext(
  authMethod: 'jwt' | 'apiKey' | undefined,
  boundProjectId: string | undefined,
  reportProjectId: string,
  ownedIds: string[],
  jwtAllowed: boolean,
  isOrgScopedKey = false,
): boolean {
  if (authMethod === 'apiKey') {
    if (isOrgScopedKey && !boundProjectId) return ownedIds.includes(reportProjectId)
    return boundProjectId === reportProjectId
  }
  return jwtAllowed
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

Deno.test('org-scoped api key enumerates all owned projects', () => {
  const ids = callerProjectIdsFromContext('apiKey', undefined, null, ['project-a', 'project-b'], true)
  assertEquals(ids, ['project-a', 'project-b'])
})

Deno.test('org-scoped api key narrows with project header', () => {
  const ids = callerProjectIdsFromContext('apiKey', undefined, 'project-b', ['project-a', 'project-b'], true)
  assertEquals(ids, ['project-b'])
})

Deno.test('org-scoped api key rejects foreign project header', () => {
  const ids = callerProjectIdsFromContext('apiKey', undefined, 'project-c', ['project-a', 'project-b'], true)
  assertEquals(ids, [])
})

Deno.test('jwt user can load report in project B while header pins project A', () => {
  const allowed = canAccessReportProjectFromContext(
    'jwt',
    undefined,
    'project-b',
    ['project-a', 'project-b'],
    true,
  )
  assertEquals(allowed, true)
})

Deno.test('project-scoped api key cannot load report outside bound project', () => {
  const allowed = canAccessReportProjectFromContext(
    'apiKey',
    'project-a',
    'project-b',
    ['project-a', 'project-b'],
    false,
  )
  assertEquals(allowed, false)
})

Deno.test('org-scoped api key can load report in any owned project', () => {
  const allowed = canAccessReportProjectFromContext(
    'apiKey',
    undefined,
    'project-b',
    ['project-a', 'project-b'],
    false,
    true,
  )
  assertEquals(allowed, true)
})
