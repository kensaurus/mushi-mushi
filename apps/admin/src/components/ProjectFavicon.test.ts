/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/ProjectFavicon.test.ts
 * PURPOSE: The console only tries icon URLs its CSP img-src allows
 *          (scripts/cloudfront-mushi-spa-response.js). An allowed host missing
 *          here drops a real icon before it is tried: tsumagoi and solo-boss,
 *          on *.kensaur.us subdomains, showed initials (2026-10-29).
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isCspLoadableImageUrl } from './ProjectFavicon'

describe('isCspLoadableImageUrl', () => {
  it("loads the owner's apps on kensaur.us subdomains, as img-src allows", () => {
    expect(isCspLoadableImageUrl('https://tsumagoi.kensaur.us/apple-touch-icon.png')).toBe(true)
    expect(isCspLoadableImageUrl('https://solo-boss.kensaur.us/favicon.svg')).toBe(true)
    expect(isCspLoadableImageUrl('https://talk.kensaur.us/pwa-192.png')).toBe(true)
  })

  it('still refuses hosts the policy does not allow', () => {
    expect(isCspLoadableImageUrl('https://example.vercel.app/favicon.ico')).toBe(false)
    expect(isCspLoadableImageUrl('https://evilkensaur.us/favicon.ico')).toBe(false)
    expect(isCspLoadableImageUrl('http://tsumagoi.kensaur.us/favicon.ico')).toBe(false)
  })

  it('stays in step with the CloudFront img-src directive', () => {
    const cf = readFileSync(join(__dirname, '..', '..', '..', '..', 'scripts', 'cloudfront-mushi-spa-response.js'), 'utf8')
    expect(cf).toContain('https://*.kensaur.us')
  })
})
