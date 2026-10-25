/**
 * @vitest-environment jsdom
 */
import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { TesterStatGrid, type TesterStatItem } from '../tester/tester-ui'
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
  function renderCard(card: ReactElement): HTMLElement {
    const host = document.createElement('div')
    host.innerHTML = renderToStaticMarkup(<MemoryRouter>{card}</MemoryRouter>)
    return host
  }

  /** Label row only. The value row and sparkline sit outside it. */
  function headerRow(card: ReactElement): HTMLElement {
    const header = renderCard(card).querySelector('div.text-2xs.flex.items-center')
    expect(header).not.toBeNull()
    return header as HTMLElement
  }

  it('keeps a plain card help icon beside the label', () => {
    const row = headerRow(<StatCard label="Accepted" value="3" hint="all-time reports" />)
    const labelCell = row.firstElementChild as HTMLElement
    expect(labelCell.className).not.toContain('flex-1')
    // Label, then the (i). No arrow-width spacer.
    expect(row.childElementCount).toBe(2)
    expect(row.lastElementChild?.getAttribute('aria-hidden')).not.toBe('true')
  })

  it('reserves the arrow slot only when a mixed row asks, so the (i) matches a linked card', () => {
    const plain = headerRow(
      <StatCard label="Accepted" value="3" hint="all-time reports" reserveLinkSlot />,
    )
    const linked = headerRow(
      <StatCard label="Balance" value="10 pts" hint="redeemable now" to="/tester/wallet" />,
    )
    const labelCell = plain.firstElementChild as HTMLElement
    expect(labelCell.className).toContain('flex-1')
    expect(labelCell.className).toContain('min-w-0')
    expect((linked.firstElementChild as HTMLElement).className).toContain('flex-1')
    expect(plain.childElementCount).toBe(linked.childElementCount)
    const spacer = plain.lastElementChild as HTMLElement
    expect(spacer.getAttribute('aria-hidden')).toBe('true')
    expect(spacer.className).toContain('w-3')
    expect(spacer.childElementCount).toBe(0)
  })

  it('adds no spacer in the header when the card has no help icon', () => {
    const host = renderCard(<StatCard label="Accepted" value="3" trend={[2, 4, 6]} />)
    const header = host.querySelector('div.text-2xs.flex.items-center')
    expect(header).not.toBeNull()
    expect(header!.childElementCount).toBe(1)
    expect(header!.firstElementChild?.textContent).toBe('Accepted')
    // The sparkline under the value is aria-hidden. A query of the whole
    // card would see it and fail even though the header has no spacer.
    expect(host.querySelector('[aria-hidden="true"]')).not.toBeNull()
  })
})

describe('TesterStatGrid help icon alignment', () => {
  function renderGrid(items: TesterStatItem[]): HTMLElement {
    const host = document.createElement('div')
    host.innerHTML = renderToStaticMarkup(
      <MemoryRouter>
        <TesterStatGrid items={items} />
      </MemoryRouter>,
    )
    return host
  }

  function headerFor(host: HTMLElement, label: string): HTMLElement {
    const labelEl = host.querySelector(`span[title="${label}"]`)
    expect(labelEl).not.toBeNull()
    return labelEl!.parentElement as HTMLElement
  }

  it('reserves the arrow slot on the plain card of a mixed /admin/tester row', () => {
    const host = renderGrid([
      { label: 'Balance', value: '10 pts', hint: 'redeemable now', to: '/tester/wallet' },
      { label: 'Accepted', value: '3', hint: 'all-time reports' },
    ])
    const header = headerFor(host, 'Accepted')
    expect((header.firstElementChild as HTMLElement).className).toContain('flex-1')
    expect(header.childElementCount).toBe(3)
    expect((header.lastElementChild as HTMLElement).className).toContain('w-3')
  })

  it('does not reserve a slot when the tester row is all plain cards', () => {
    const host = renderGrid([
      { label: 'Balance', value: '10 pts', hint: 'redeemable now' },
      { label: 'Accepted', value: '3', hint: 'all-time reports' },
    ])
    for (const label of ['Balance', 'Accepted']) {
      const header = headerFor(host, label)
      expect((header.firstElementChild as HTMLElement).className).not.toContain('flex-1')
      expect(header.childElementCount).toBe(2)
    }
  })
})
