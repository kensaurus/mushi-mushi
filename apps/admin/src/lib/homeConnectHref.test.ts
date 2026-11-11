import { describe, expect, it } from 'vitest'
import { homeConnectHref } from './homeConnectHref'

describe('homeConnectHref', () => {
  it('sends "Turn on the live-site watch" to the card that turns it on, not to Spend credits', () => {
    expect(homeConnectHref({ label: 'Turn on the live-site watch', to: '/credits' })).toBe('/inventory?tab=discovery#site-watch')
  })

  it('leaves every other hint where the server points it', () => {
    expect(homeConnectHref({ label: 'Install the SDK', to: '/connect?project=p#connect-sdk' })).toBe('/connect?project=p#connect-sdk')
    expect(homeConnectHref({ label: 'Add a Firecrawl key', to: '/credits' })).toBe('/credits')
  })
})
