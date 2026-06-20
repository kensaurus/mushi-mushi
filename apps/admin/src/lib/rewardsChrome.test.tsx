import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { RewardsTabNav } from '../components/rewards/RewardsTabNav'
import { RewardsSnapshotStrip } from '../components/rewards/RewardsSnapshotStrip'
import { EMPTY_REWARDS_STATS } from '../components/rewards/types'

describe('Rewards responsive chrome', () => {
  it('RewardsTabNav renders scrollable segmented control', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <RewardsTabNav active="overview" onChange={() => {}} />
      </MemoryRouter>,
    )
    expect(html).toContain('overflow-x-auto')
    expect(html).toContain('Overview')
    expect(html).toContain('Settings')
  })

  it('RewardsTabNav hidden in quickstart mode flag', () => {
    const html = renderToStaticMarkup(
      <RewardsTabNav active="overview" onChange={() => {}} hideTabs />,
    )
    expect(html).toBe('')
  })

  it('RewardsSnapshotStrip compact uses 4-column metric strip', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <RewardsSnapshotStrip
          stats={EMPTY_REWARDS_STATS}
          statsFetchedAt={null}
          compact
        />
      </MemoryRouter>,
    )
    expect(html).toContain('REWARDS SNAPSHOT')
    expect(html).toContain('Active contributors')
  })
})
