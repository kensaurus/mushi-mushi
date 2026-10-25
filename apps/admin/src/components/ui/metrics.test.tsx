/**
 * @vitest-environment jsdom
 */
import type { ReactElement } from 'react'
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

describe('StatCard help icon alignment', () => {
  /** The label row: label, then the (i) trigger, then the arrow slot. */
  function headerRow(card: ReactElement): HTMLElement {
    const host = document.createElement('div')
    host.innerHTML = renderToStaticMarkup(<MemoryRouter>{card}</MemoryRouter>)
    const button = host.querySelector('button[aria-label]')
    expect(button).not.toBeNull()
    return button!.parentElement!.closest('div')!
  }

  it('gives a plain card the same flex-1 label as a linked one, so the (i) is right-aligned', () => {
    for (const card of [
      <StatCard key="plain" label="Accepted" value="3" hint="all-time reports" />,
      <StatCard key="linked" label="Balance" value="10 pts" hint="redeemable now" to="/tester/wallet" />,
    ]) {
      const row = headerRow(card)
      const labelCell = row.firstElementChild as HTMLElement
      expect(labelCell.className).toContain('flex-1')
      expect(labelCell.className).toContain('min-w-0')
    }
  })

  it('reserves the arrow slot on a plain card so both cards place the (i) at the same x', () => {
    const plain = headerRow(<StatCard label="Accepted" value="3" hint="all-time reports" />)
    const linked = headerRow(
      <StatCard label="Balance" value="10 pts" hint="redeemable now" to="/tester/wallet" />,
    )
    expect(plain.childElementCount).toBe(linked.childElementCount)
    const spacer = plain.lastElementChild as HTMLElement
    expect(spacer.getAttribute('aria-hidden')).toBe('true')
    expect(spacer.className).toContain('w-3')
  })

  it('adds no spacer when the card has no help icon', () => {
    const host = document.createElement('div')
    host.innerHTML = renderToStaticMarkup(<StatCard label="Accepted" value="3" />)
    expect(host.querySelector('[aria-hidden="true"]')).toBeNull()
  })
})
