import { describe, expect, it } from 'vitest'
import { EMPTY_FORM, accountPayload, findingsFor, formFromAccount, triFrom, triLabel, triTo, type RegisterAccount } from './accountsRegisterView'

const account: RegisterAccount = {
  id: 'a1', externalId: 'registrar:porkbun', provider: 'registrar', name: 'Porkbun', ownerEmail: 'k@example.com',
  twoFactorDeclared: null, recoveryContact: null, adminCount: 1, autoRenew: false,
}

describe('accountPayload', () => {
  it('turns empty text into null and parses the people count', () => {
    const r = accountPayload({ ...EMPTY_FORM, provider: 'apple', name: '  Kenji Ltd ', twoFactor: 'yes', adminCount: '2', autoRenew: 'no' })
    expect(r).toEqual({ ok: true, body: { provider: 'apple', displayName: 'Kenji Ltd', ownerEmail: null, twoFactorDeclared: true, adminCount: 2, recoveryContact: null, autoRenew: null } })
  })

  it('sends auto-renew only for a registrar', () => {
    const r = accountPayload({ ...EMPTY_FORM, provider: 'registrar', name: 'Porkbun', autoRenew: 'no' })
    expect(r.ok && r.body.autoRenew).toBe(false)
  })

  it('refuses a missing name, a bad email and an out-of-range count, in plain words', () => {
    expect(accountPayload({ ...EMPTY_FORM, name: ' ' })).toMatchObject({ ok: false })
    expect(accountPayload({ ...EMPTY_FORM, name: 'x', ownerEmail: 'not-an-email' })).toEqual({ ok: false, error: 'The owner email does not look like an email address.' })
    expect(accountPayload({ ...EMPTY_FORM, name: 'x', adminCount: '0' })).toMatchObject({ ok: false })
  })
})

describe('form and tri-state helpers', () => {
  it('round-trips an account through the form', () => {
    const f = formFromAccount(account)
    expect(f).toMatchObject({ provider: 'registrar', name: 'Porkbun', twoFactor: '', adminCount: '1', autoRenew: 'no' })
    expect(accountPayload(f)).toMatchObject({ ok: true, body: { autoRenew: false, ownerEmail: 'k@example.com' } })
  })

  it('maps yes / no / not declared both ways and labels them', () => {
    expect([triFrom(true), triFrom(false), triFrom(null)]).toEqual(['yes', 'no', ''])
    expect([triTo('yes'), triTo('no'), triTo('')]).toEqual([true, false, null])
    expect(triLabel(null)).toBe('not declared')
  })

  it('finds an account’s and a domain’s findings by the server resource key', () => {
    const findings = [
      { ruleId: 'registrar_autorenew_off', severity: 'warn' as const, resourceKey: 'account:registrar:porkbun', message: 'm', suggestedFix: 'f' },
      { ruleId: 'registrar_autorenew_off', severity: 'warn' as const, resourceKey: 'domain:glot.it', message: 'm', suggestedFix: 'f' },
    ]
    expect(findingsFor(account, findings)).toHaveLength(1)
    expect(findingsFor({ domain: 'glot.it' }, findings)[0].resourceKey).toBe('domain:glot.it')
  })
})
