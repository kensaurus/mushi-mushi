import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isLocalDevUrl } from './reportOrigin'

const LOCAL = [
  'http://localhost:8081/albums',
  'http://127.0.0.1:8081/friends',
  'http://localhost:5174/bank-statement?tab=accounts',
  'http://[::1]:3000/',
  'http://192.168.1.20:8081/',
  'exp://10.0.0.5:8081',
  'http://172.20.4.2:5173/x',
  'http://my-mac.local:3000/',
  'https://app.localhost/settings',
  'http://shop.test/cart',
]
const DEPLOYED = [
  'https://localhost/',
  'https://localhost/reader/3',
  'capacitor://localhost/home',
  'http://localhost/',
  'https://kensaur.us/help-her-take-photo/onboarding',
  'https://localhost.example.com/',
  'https://172.32.0.1/',
  'https://testing.app/',
  '',
  null,
]

describe('isLocalDevUrl', () => {
  it.each(LOCAL)('local: %s', (url) => expect(isLocalDevUrl(url)).toBe(true))
  it.each(DEPLOYED)('deployed: %s', (url) => expect(isLocalDevUrl(url)).toBe(false))

  it('is the same pattern the server filters the list with', () => {
    const server = readFileSync(
      resolve(__dirname, '../../../../packages/server/supabase/functions/_shared/report-origin.ts'),
      'utf8',
    )
    const admin = readFileSync(resolve(__dirname, 'reportOrigin.ts'), 'utf8')
    // The quoted pieces from the first `'^[a-z]` up to the `)([/?#]|$)'` piece.
    const pattern = (src: string) => {
      const start = src.indexOf("'^[a-z]")
      const end = src.indexOf("')([/?#]|$)'", start) + "')([/?#]|$)'".length
      return [...src.slice(start, end).matchAll(/'([^']*)'/g)].map((m) => m[1]).join('')
    }
    expect(pattern(admin)).toBe(pattern(server))
    expect(pattern(admin)).toContain('localhost|127')
  })
})
