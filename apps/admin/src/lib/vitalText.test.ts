/**
 * Vitals written as words become badges (owner, 2026-11-18): the parser finds
 * each one in titles and summaries, with its value in the badge's units.
 */
import { describe, expect, it } from 'vitest'
import { splitVitalText } from './vitalText'

const vitals = (text: string) => splitVitalText(text).filter((p) => typeof p !== 'string')

describe('splitVitalText', () => {
  it.each([
    ['LCP of 7444 ms', 'LCP', 7444],
    ['LCP 6408ms', 'LCP', 6408],
    ['LCP: 7.4 s', 'LCP', 7400],
    ['Poor INP: 432.0 on /chat', 'INP', 432],
    ['CLS of 0.31', 'CLS', 0.31],
    ['CLS 0.12', 'CLS', 0.12],
    ['ttfb was 900', 'TTFB', 900],
    ['LCP 3 seconds', 'LCP', 3000],
  ])('%s', (text, name, value) => {
    expect(vitals(text)).toEqual([expect.objectContaining({ name, value })])
  })

  it('keeps the words around each vital, in order', () => {
    expect(splitVitalText('Homepage LCP 6408ms · CLS 0.12 on /')).toEqual([
      'Homepage ',
      { name: 'LCP', value: 6408, raw: 'LCP 6408ms' },
      ' · ',
      { name: 'CLS', value: 0.12, raw: 'CLS 0.12' },
      ' on /',
    ])
  })

  it('leaves look-alikes and bare names alone', () => {
    expect(splitVitalText('INPUT 300 broke')).toEqual(['INPUT 300 broke'])
    expect(splitVitalText('CLS got worse')).toEqual(['CLS got worse'])
    expect(splitVitalText('')).toEqual([''])
  })
})
