/**
 * FILE: packages/server/supabase/functions/mcp/mrtr.test.ts
 * PURPOSE: The MRTR `requestState` codec (_shared/mcp-mrtr.ts) — signed,
 *          10-minute, single-use — plus ElicitResult parsing. Pure: Web
 *          Crypto only, no env, no network.
 */

import { assert, assertEquals, assertNotEquals, assertStrictEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import {
  REQUEST_STATE_TTL_MS,
  buildInputRequired,
  createMemoryNonceStore,
  createRequestStateCodec,
  describeRequestStateFailure,
  elicitationRequest,
  parseElicitResult,
  readInputResponses,
  resolveRequestStateSecret,
} from '../_shared/mcp-mrtr.ts'

interface Payload {
  kind: string
  reportId: string
}

const SECRET = 'unit-test-secret-do-not-use'

Deno.test('codec: sign → verify round-trips the payload and the envelope is opaque base64url', async () => {
  const codec = createRequestStateCodec<Payload>({ secret: SECRET })
  const token = await codec.sign({ kind: 'voice_confirm', reportId: 'r1' })
  assert(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token))
  const v = await codec.verify(token)
  assert(v.ok)
  assertEquals(v.payload, { kind: 'voice_confirm', reportId: 'r1' })
})

Deno.test('codec: tampered body ⇒ bad_signature; garbage ⇒ malformed', async () => {
  const codec = createRequestStateCodec<Payload>({ secret: SECRET })
  const token = await codec.sign({ kind: 'voice_confirm', reportId: 'r1' })
  const [body, sig] = token.split('.')
  // Flip one character of the body (keeps it base64url-valid).
  const flipped = (body[0] === 'A' ? 'B' : 'A') + body.slice(1)
  const tampered = await codec.verify(`${flipped}.${sig}`)
  assert(!tampered.ok && tampered.reason === 'bad_signature')

  for (const bad of ['', 'nodot', '.', 'a.', '.b', 'a.b', 42, null, { token }]) {
    const r = await codec.verify(bad)
    assert(!r.ok, String(bad))
  }
})

Deno.test('codec: a token signed with another secret is rejected', async () => {
  const a = createRequestStateCodec<Payload>({ secret: SECRET })
  const b = createRequestStateCodec<Payload>({ secret: 'other' })
  const token = await a.sign({ kind: 'voice_confirm', reportId: 'r1' })
  const r = await b.verify(token)
  assert(!r.ok && r.reason === 'bad_signature')
})

Deno.test('codec: expires after 10 minutes', async () => {
  const codec = createRequestStateCodec<Payload>({ secret: SECRET })
  const issued = 1_700_000_000_000
  const token = await codec.sign({ kind: 'voice_confirm', reportId: 'r1' }, issued)
  assertEquals(REQUEST_STATE_TTL_MS, 600_000)
  const stillValid = await codec.verify(token, issued + REQUEST_STATE_TTL_MS - 1)
  assert(stillValid.ok)
  const codec2 = createRequestStateCodec<Payload>({ secret: SECRET })
  const expired = await codec2.verify(token, issued + REQUEST_STATE_TTL_MS)
  assert(!expired.ok && expired.reason === 'expired')
})

Deno.test('codec: single use — the second verify of the same token is replayed', async () => {
  const codec = createRequestStateCodec<Payload>({ secret: SECRET })
  const token = await codec.sign({ kind: 'voice_confirm', reportId: 'r1' })
  const first = await codec.verify(token)
  assert(first.ok)
  const second = await codec.verify(token)
  assert(!second.ok && second.reason === 'replayed')
  // A fresh sign yields a different nonce, so it is accepted.
  const again = await codec.sign({ kind: 'voice_confirm', reportId: 'r1' })
  assertNotEquals(again, token)
  assert((await codec.verify(again)).ok)
})

Deno.test('codec: custom consumeNonce store is consulted (pluggable cross-isolate guard)', async () => {
  const consumed: string[] = []
  const codec = createRequestStateCodec<Payload>({
    secret: SECRET,
    consumeNonce: (nonce) => {
      consumed.push(nonce)
      return consumed.filter((n) => n === nonce).length === 1
    },
  })
  const token = await codec.sign({ kind: 'voice_confirm', reportId: 'r1' })
  assert((await codec.verify(token)).ok)
  const replay = await codec.verify(token)
  assert(!replay.ok && replay.reason === 'replayed')
  assertEquals(consumed.length, 2)
})

Deno.test('memory nonce store: rejects duplicates and prunes expired entries', () => {
  const consume = createMemoryNonceStore()
  const future = Date.now() + 60_000
  assert(consume('n1', future))
  assert(!consume('n1', future))
  // Overflow the prune threshold with already-expired entries; a fresh nonce still works.
  for (let i = 0; i < 600; i++) consume(`old-${i}`, 1)
  assert(consume('n2', future))
})

Deno.test('resolveRequestStateSecret: internal caller secret first, service-role key as fallback', () => {
  const env = (vals: Record<string, string | undefined>) => ({ get: (k: string) => vals[k] })
  assertEquals(resolveRequestStateSecret(env({ MUSHI_INTERNAL_CALLER_SECRET: 'ic', SUPABASE_SERVICE_ROLE_KEY: 'sr' })), 'ic')
  assertEquals(resolveRequestStateSecret(env({ SUPABASE_SERVICE_ROLE_KEY: 'sr' })), 'sr')
  assertEquals(resolveRequestStateSecret(env({ MUSHI_INTERNAL_CALLER_SECRET: '  ' , SUPABASE_SERVICE_ROLE_KEY: 'sr' })), 'sr')
  assertStrictEquals(resolveRequestStateSecret(env({})), null)
})

Deno.test('ElicitResult parsing: strict on action, content optional, invalid entries dropped', () => {
  assertEquals(parseElicitResult({ action: 'accept', content: { confirm: true } }), {
    action: 'accept',
    content: { confirm: true },
  })
  assertEquals(parseElicitResult({ action: 'decline' }), { action: 'decline' })
  assertStrictEquals(parseElicitResult({ action: 'yes' }), null)
  assertStrictEquals(parseElicitResult('accept'), null)
  assertEquals(
    readInputResponses({ inputResponses: { confirm: { action: 'cancel' }, junk: { action: 'nope' } } }),
    { confirm: { action: 'cancel' } },
  )
  assertEquals(readInputResponses({}), {})
})

Deno.test('input_required wire shape', () => {
  const r = buildInputRequired(
    { confirm: elicitationRequest('Confirm?', { type: 'object', properties: { confirm: { type: 'boolean' } }, required: ['confirm'] }) },
    'state',
  )
  assertEquals(r.resultType, 'input_required')
  assertEquals(r.inputRequests.confirm.method, 'elicitation/create')
  assertEquals(r.inputRequests.confirm.params.message, 'Confirm?')
  assertEquals(r.requestState, 'state')
  assert(describeRequestStateFailure('expired').includes('expired'))
})
