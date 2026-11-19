/**
 * FILE: apps/admin/src/lib/providersNeeds.test.ts
 * PURPOSE: Providers & AI routes (2026-11-19): an off or unchecked account says what it needs in
 *          one line (with Turn on when the console can do it), "Used by" is one chip per app with
 *          its features, and a missing balance says why.
 */

import { describe, expect, it } from 'vitest'
import type { ProviderAccount } from './kensaurusOpsTypes'
import { appUses, balanceWhy, makeAppProjectFinder, providerColumns, providerNeeds, providersLead, PROVIDER_STATE_WORD } from './providersView'

const NOW = Date.parse('2026-11-19T12:00:00Z')

const account = (over: Partial<ProviderAccount> = {}, status: ProviderAccount['status'] = null): ProviderAccount =>
  ({ id: 'kenji:fal', provider: 'fal', label: 'fal.ai', host_project: 'kenji', origin: 'pull', probe_kind: 'auth_only', secret_name: 'FAL_KEY', depends: [], thresholds: {}, enabled: true, is_test: false, updated_at: '', updated_by: '', status, ...over }) as ProviderAccount

const status = (over: Partial<NonNullable<ProviderAccount['status']>>): NonNullable<ProviderAccount['status']> => ({
  state: 'ok', state_since: null, pending_state: null, class: null, last_probe_at: '2026-11-19T09:00:00Z', last_ok_at: null, http_status: 200, balance_micro: null, usage: null, detail: null, ...over,
})

describe('providerNeeds', () => {
  it('offers Turn on for an account that is off', () => {
    expect(providerNeeds(account({ enabled: false }), NOW)).toEqual({ text: 'Off: the router skips it, so no app calls it. Turn it on to route to it again.', action: 'turn_on' })
  })

  it('explains an unchecked account from its data, with no fake button', () => {
    // A null secret name says nothing about probing (probed, ok accounts have one too).
    expect(providerNeeds(account({ secret_name: null }), NOW)).toEqual({ text: 'Not checked yet: the provider watch on kenji has no reading for it. It shows here after its first check.', action: null })
    expect(providerNeeds(account({}, status({ state: 'unknown', detail: 'HTTP 418' })), NOW)?.text).toBe('The last check could not tell whether it works: HTTP 418')
    expect(providerNeeds(account({}, status({ state: 'stale' })), NOW)?.text).toBe('Last checked 3h ago; the watch on kenji has not probed it since.')
  })

  it('says nothing for a working account', () => {
    expect(providerNeeds(account({}, status({ state: 'ok' })), NOW)).toBeNull()
    expect(PROVIDER_STATE_WORD.unknown).toBe('Not checked')
  })
})

describe('Used by', () => {
  it('is one entry per app with its features, sorted by the console name', () => {
    const p = account({ depends: [{ app: 'yen-yen', feature: 'tts' }, { app: 'glot-it', feature: 'chat' }, { app: 'yen-yen', feature: 'chat' }, { app: 'yen-yen' }] })
    expect(appUses(p)).toEqual([
      { app: 'glot-it', features: ['chat'] },
      { app: 'yen-yen', features: ['chat', 'tts'] },
    ])
  })

  it('finds the project for an ops slug, ignoring case and punctuation', () => {
    const find = makeAppProjectFinder([{ project_name: 'lets-talk', project_slug: 'how-to-talk-to-girls' }])
    expect(find('How_To_Talk_To_Girls')?.project_name).toBe('lets-talk')
    expect(find('unknown')).toBeNull()
  })
})

describe('balance', () => {
  it('says why there is no balance bar', () => {
    expect(balanceWhy(account())).toBe('key check only')
    expect(balanceWhy(account({ probe_kind: 'balance' }))).toBe('not reported')
    expect(providerColumns([account(), account({ id: 'kenji:x' })], new Map()).note).toBe(
      'Balance: not shown, because each account’s check only tests that its key works · no open incidents',
    )
  })
})

describe('providersLead', () => {
  it('names the accounts that need a look, worst first, and offers to turn an off one on', () => {
    const off = account({ id: 'kenji:el', label: 'ElevenLabs', enabled: false }, status({ state: 'ok' }))
    const unchecked = account({ id: 'kenji:fal', label: 'fal.ai' })
    const down = account({ id: 'kenji:openai', label: 'OpenAI (shared key)' }, status({ state: 'down' }))
    const ok = account({ id: 'kenji:anthropic', label: 'Anthropic' }, status({ state: 'ok' }))
    const lead = providersLead([ok, off, unchecked, down])
    expect(lead.sentence).toBe('3 accounts need a look: OpenAI is down, fal.ai is not checked, ElevenLabs is off.')
    expect(lead.tone).toBe('danger')
    expect(lead.working).toBe(1)
    expect(lead.turnOn?.id).toBe('kenji:el')
  })

  it('says all are working when none needs a look', () => {
    const lead = providersLead([account({}, status({ state: 'ok' }))])
    expect(lead).toMatchObject({ sentence: 'The provider account is working.', tone: 'ok', turnOn: null })
  })
})
