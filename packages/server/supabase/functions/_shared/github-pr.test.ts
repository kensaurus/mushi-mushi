import { assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { generateFixBranchName } from './github-pr.ts'

// Retry tests set a 1ms base backoff so the suite stays fast; the module
// reads env at import time so this must happen before the dynamic import
// below.
Deno.env.set('MUSHI_GITHUB_BASE_BACKOFF_MS', '1')
Deno.env.set('MUSHI_GITHUB_MAX_RETRIES', '3')
const { ghFetch, ghFetchOptional } = await import('./github-pr.ts')

type MockStep = { kind: 'response'; response: Response } | { kind: 'error'; error: Error }

function mockFetchSequence(steps: MockStep[]) {
  let call = 0
  const original = globalThis.fetch
  globalThis.fetch = ((..._args: Parameters<typeof fetch>) => {
    const step = steps[Math.min(call, steps.length - 1)]
    call++
    if (step.kind === 'error') return Promise.reject(step.error)
    return Promise.resolve(step.response)
  }) as typeof fetch
  return {
    callCount: () => call,
    restore: () => {
      globalThis.fetch = original
    },
  }
}

Deno.test('generateFixBranchName falls back when legacy template is invalid', () => {
  const reportId = '426f1bf0-0000-4000-8000-000000000001'
  const name = generateFixBranchName(
    reportId,
    'mushi/fix/{date}-bug-{shortId}',
    'ui-bug',
    'null-pointer',
  )

  assertEquals(name, `bugfix/MUSHI-${reportId}-null-pointer`)
})

Deno.test('generateFixBranchName uses default when template is empty', () => {
  const reportId = '426f1bf0-0000-4000-8000-000000000001'
  const name = generateFixBranchName(reportId, null, 'ui-bug', 'crash')
  assertEquals(name, `bugfix/MUSHI-${reportId}-crash`)
})

Deno.test('ghFetch retries a transient 503 then succeeds', async () => {
  const mock = mockFetchSequence([
    { kind: 'response', response: new Response('Service Unavailable', { status: 503 }) },
    { kind: 'response', response: new Response(JSON.stringify({ ok: true }), { status: 200 }) },
  ])
  try {
    const result = await ghFetch('https://api.github.com/repos/x/y', { headers: {} })
    assertEquals(result, { ok: true })
    assertEquals(mock.callCount(), 2)
  } finally {
    mock.restore()
  }
})

Deno.test('ghFetch retries a raw network error then succeeds', async () => {
  const mock = mockFetchSequence([
    { kind: 'error', error: new TypeError('fetch failed') },
    { kind: 'response', response: new Response(JSON.stringify({ ok: true }), { status: 200 }) },
  ])
  try {
    const result = await ghFetch('https://api.github.com/repos/x/y', { headers: {} })
    assertEquals(result, { ok: true })
    assertEquals(mock.callCount(), 2)
  } finally {
    mock.restore()
  }
})

Deno.test('ghFetch does NOT retry a 4xx and throws immediately', async () => {
  const mock = mockFetchSequence([
    { kind: 'response', response: new Response('Bad credentials', { status: 401 }) },
  ])
  try {
    await assertRejects(() => ghFetch('https://api.github.com/repos/x/y', { headers: {} }))
    assertEquals(mock.callCount(), 1)
  } finally {
    mock.restore()
  }
})

Deno.test('ghFetch gives up after exhausting retries on persistent 500s', async () => {
  const mock = mockFetchSequence([
    { kind: 'response', response: new Response('boom', { status: 500 }) },
  ])
  try {
    await assertRejects(() => ghFetch('https://api.github.com/repos/x/y', { headers: {} }))
    // MUSHI_GITHUB_MAX_RETRIES=3 → 1 initial attempt + 3 retries = 4 calls.
    assertEquals(mock.callCount(), 4)
  } finally {
    mock.restore()
  }
})

Deno.test('ghFetchOptional treats a persistent 404 as null without retrying', async () => {
  const mock = mockFetchSequence([
    { kind: 'response', response: new Response('Not Found', { status: 404 }) },
  ])
  try {
    const result = await ghFetchOptional('https://api.github.com/repos/x/y', { headers: {} })
    assertEquals(result, null)
    assertEquals(mock.callCount(), 1)
  } finally {
    mock.restore()
  }
})
