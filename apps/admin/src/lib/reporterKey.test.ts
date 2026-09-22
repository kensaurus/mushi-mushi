import { describe, expect, it } from 'vitest'

import { shortReporterKey } from './reporterKey'

describe('shortReporterKey', () => {
  it('drops the key version prefix', () => {
    expect(shortReporterKey('rk1_7d3a51b170c46c3051da354b21341b01')).toBe('7d3a51b1')
    expect(shortReporterKey('rk1_7d3a51b170c46c3051da354b21341b01', 6)).toBe('7d3a51')
  })

  it('leaves digests and sentinels readable', () => {
    expect(shortReporterKey('f795dd18f54c10ffd14db9abfa22bfd0')).toBe('f795dd18')
    expect(shortReporterKey('cron:library')).toBe('cron:lib')
  })
})
