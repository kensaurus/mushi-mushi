/**
 * FILE: apps/admin/src/components/rewards/rewardsGroupK.test.ts
 * PURPOSE: Pure pieces of the console group K rewards fixes (2026-10-04).
 */

import { describe, expect, it } from 'vitest'
import { paginationWindow } from './paginationWindow'
import { revealedSecretFromMeta } from './WebhookSecretReveal'
import { describeWebhookTest } from './webhookTestOutcome'

describe('paginationWindow (entry 316)', () => {
  it('lists every page when they fit', () => {
    expect(paginationWindow(0, 5)).toEqual([0, 1, 2, 3, 4])
  })

  it('never repeats a page or goes out of range at the start', () => {
    const pages = paginationWindow(0, 20)
    expect(pages).toEqual([0, 1, 2, 3, 4, 5, 19])
    expect(new Set(pages).size).toBe(pages.length)
  })

  it('never repeats the last page near the end', () => {
    const pages = paginationWindow(19, 20)
    expect(pages).toEqual([0, 14, 15, 16, 17, 18, 19])
    expect(new Set(pages).size).toBe(pages.length)
  })

  it('centres the window on the current page', () => {
    expect(paginationWindow(10, 20)).toEqual([0, 8, 9, 10, 11, 12, 19])
  })

  it('stays unique and ascending for every page', () => {
    for (let total = 1; total <= 30; total += 1) {
      for (let page = 0; page < total; page += 1) {
        const pages = paginationWindow(page, total)
        expect(pages).toContain(page)
        expect([...pages].sort((a, b) => a - b)).toEqual(pages)
        expect(new Set(pages).size).toBe(pages.length)
        expect(Math.min(...pages)).toBeGreaterThanOrEqual(0)
        expect(Math.max(...pages)).toBeLessThan(total)
      }
    }
  })
})

describe('revealedSecretFromMeta (entry 8)', () => {
  it('reads the one-time secret from the create response meta', () => {
    expect(
      revealedSecretFromMeta('https://app.example/hook', {
        secret: 'mushi_whk_abc',
        secret_shown_once: true,
        vaulted: true,
        message: 'Copy this secret now',
      }),
    ).toEqual({ url: 'https://app.example/hook', secret: 'mushi_whk_abc', vaulted: true, message: 'Copy this secret now' })
  })

  it('flags the Vault fallback when the server could not vault it', () => {
    expect(revealedSecretFromMeta('https://x', { secret: 's', vaulted: false })?.vaulted).toBe(false)
  })

  it('returns null when there is no secret (operator supplied their own)', () => {
    expect(revealedSecretFromMeta('https://x', undefined)).toBeNull()
    expect(revealedSecretFromMeta('https://x', { secret: '' })).toBeNull()
  })
})

describe('describeWebhookTest (entry 221)', () => {
  it('reports success only when every endpoint answered 2xx', () => {
    expect(
      describeWebhookTest({ attempted: 2, delivered: 2, failed: 0, results: [] }),
    ).toEqual({ ok: true, title: 'Test event delivered to 2 webhooks' })
  })

  it('names the endpoints that failed and how', () => {
    const outcome = describeWebhookTest({
      attempted: 2,
      delivered: 1,
      failed: 1,
      results: [
        { url: 'https://ok.example', status: 200, ok: true },
        { url: 'https://down.example', status: 500, ok: false },
      ],
    })
    expect(outcome.ok).toBe(false)
    expect(outcome.title).toBe('1 of 2 webhooks did not accept the test event')
    expect(outcome.detail).toContain('https://down.example (HTTP 500)')
  })

  it('explains a timeout and a missing secret', () => {
    const outcome = describeWebhookTest({
      attempted: 2,
      delivered: 0,
      failed: 2,
      results: [
        { url: 'https://slow.example', status: 0, ok: false },
        { url: 'https://nokey.example', status: 0, ok: false, skipped: 'no_secret' },
      ],
    })
    expect(outcome.detail).toContain('https://slow.example (no response)')
    expect(outcome.detail).toContain('no signing secret stored')
  })

  it('says when there was nothing to test', () => {
    expect(describeWebhookTest({ attempted: 0, delivered: 0, failed: 0, results: [] }).ok).toBe(false)
    expect(describeWebhookTest(undefined).title).toMatch(/no enabled webhook/i)
  })
})
