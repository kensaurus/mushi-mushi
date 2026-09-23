import { assert, assertFalse } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { boundKeyTargetsOtherProject } from '../../_shared/bound-key.ts'

// API keys authenticate as their owner; before 2026-09-23 a key bound to
// project A could act on any other project the owner reached (fix dispatch,
// sdk-upgrade, CI secrets, keys, integrations, …). callerCanAccessProject in
// api/shared.ts applies this rule before the owner's membership check.

const A = '11111111-2222-4333-8444-555555555555'
const B = '99999999-8888-4777-8666-555555555555'

Deno.test('a project-bound key aimed at another project is refused', () => {
  assert(boundKeyTargetsOtherProject('apiKey', A, B))
})

Deno.test('a project-bound key on its own project passes to the membership check', () => {
  assertFalse(boundKeyTargetsOtherProject('apiKey', A, A))
})

Deno.test('org-scoped keys and JWT sessions are not narrowed here', () => {
  assertFalse(boundKeyTargetsOtherProject('apiKey', undefined, B))
  assertFalse(boundKeyTargetsOtherProject('apiKey', '', B))
  // resolveOwnedProject sets projectId on JWT requests too; that must not
  // stop an admin from opening another project they belong to.
  assertFalse(boundKeyTargetsOtherProject('jwt', A, B))
})
