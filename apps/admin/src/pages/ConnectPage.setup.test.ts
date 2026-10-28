/**
 * Connect taught installing the SDK a third time: a yellow "Finish setup
 * first … before wiring integrations here" banner above its own "Set up the
 * SDK" section, beside Set up's snippet (integrator's new-user walk,
 * 2026-10-28). It now points to Set up once. The page is too heavy to render
 * here, so this is pinned in source.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const src = readFileSync(join(__dirname, 'ConnectPage.tsx'), 'utf8')

describe('Connect and SDK setup', () => {
  it('has no setup banner or second install guide', () => {
    expect(src).not.toContain('Finish setup first')
    expect(src).not.toContain('<CliSetupGuide')
  })

  it('points to Set up for the install', () => {
    expect(src).toContain('data-testid="connect-install-pointer"')
    expect(src).toMatch(/<Link to="\/onboarding"[^>]*>\s*Install the SDK on Set up/)
  })
})
