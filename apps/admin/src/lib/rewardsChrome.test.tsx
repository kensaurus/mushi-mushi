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

  // Page status (P1, console journeys 2026-10-27): a sentence and at most
  // three numbers; a program with nothing to count shows no wall of zeros.
  it('RewardsSnapshotStrip says the program is off instead of six zero tiles', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <RewardsSnapshotStrip stats={EMPTY_REWARDS_STATS} statsFetchedAt={null} />
      </MemoryRouter>,
    )
    expect(html).toContain('Rewards are off for this app.')
    expect(html).not.toContain('<dl')
  })

  it('RewardsSnapshotStrip shows three linked numbers once testers earn points', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <RewardsSnapshotStrip
          stats={{ ...EMPTY_REWARDS_STATS, projectRewardsEnabled: true, activeContributors30d: 56, pointsAwarded30d: 981 }}
          statsFetchedAt={null}
        />
      </MemoryRouter>,
    )
    expect(html).toContain('56 testers earned 981 points in the last 30 days')
    expect(html.match(/<dd/g)).toHaveLength(3)
  })
})
