/**
 * @vitest-environment jsdom
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { MiniInlineBar, StatCard } from './metrics'

describe('MiniInlineBar', () => {
  it('is a named meter with range values when labeled', () => {
    const html = renderToStaticMarkup(<MiniInlineBar value={30} max={60} aria-label="Confidence" />)
    expect(html).toContain('role="meter"')
    expect(html).toContain('aria-valuenow="50"')
  })

  it('puts no range ARIA on an unlabeled bar and hides it instead', () => {
    const html = renderToStaticMarkup(<MiniInlineBar value={30} />)
    expect(html).not.toContain('aria-valuenow')
    expect(html).toContain('aria-hidden="true"')
  })
})

describe('StatCard help icon slot', () => {
  it('grows a plain card and reserves the arrow width only when a linked sibling needs it', () => {
    const reserved = renderToStaticMarkup(
      <StatCard label="Accepted" value="27" hint="all-time reports" reserveLinkSlot />,
    )
    const beside = renderToStaticMarkup(
      <StatCard label="Accepted" value="27" hint="all-time reports" />,
    )
    expect(reserved).toContain('flex-1 min-w-0 truncate')
    expect(reserved).toContain('h-3 w-3 shrink-0')
    expect(beside).not.toContain('flex-1')
    expect(beside).not.toContain('h-3 w-3 shrink-0')
  })

  it('keeps a linked card on its own arrow and ignores the reserved slot', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <StatCard label="Balance" value="10 pts" hint="redeemable now" to="/tester/wallet" reserveLinkSlot />
      </MemoryRouter>,
    )
    expect(html).toContain('stat-card-arrow')
    expect(html).not.toContain('h-3 w-3 shrink-0')
  })
})
