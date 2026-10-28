/**
 * Connect taught installing the SDK twice or three times: a "Finish setup
 * first" banner, a pointer to Set up, and its own Bug capture install card
 * (integrator's walk and the first-time user test, 2026-10-28). The install
 * now lives once, in Bug capture, whose snippet fills in a new key; the
 * "App checked in" pill is the one status. The page is too heavy to render
 * here, so this is pinned in source.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const src = readFileSync(join(__dirname, 'ConnectPage.tsx'), 'utf8')

describe('Connect and SDK setup', () => {
  it('has no setup banner, second install guide or pointer elsewhere', () => {
    expect(src).not.toContain('Finish setup first')
    expect(src).not.toContain('<CliSetupGuide')
    expect(src).not.toContain('connect-install-pointer')
    expect(src).not.toContain('Install the SDK on Set up')
  })

  it('installs the SDK in one place', () => {
    expect(src.split('<SdkInstallCard').length - 1).toBe(1)
  })
})
