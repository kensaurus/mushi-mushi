/**
 * /investors and the landing's real-diagnosis card make claims a reader will
 * act on, so the parts that must not drift are pinned here:
 *
 *  - the investors page quotes the north star verbatim, as plain text (the
 *    llms mirrors drop expression-only lines);
 *  - it carries the not-an-offer disclaimer and never states raise terms;
 *  - its contact is the product inbox from docs/adr/0015;
 *  - the landing's diagnosis card always says where the diagnosis came from.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { MUSHI_TAGLINE_V2 } from '@mushi-mushi/brand'
import { LANDING_REAL_DIAGNOSIS } from './landing-copy'

const __dirname = dirname(fileURLToPath(import.meta.url))
const investors = readFileSync(join(__dirname, '..', 'content', 'investors.mdx'), 'utf8')
const flat = investors.replace(/\s+/g, ' ')

describe('/investors page', () => {
  it('quotes the north-star sentence verbatim as plain text', () => {
    expect(investors).toContain(`\n${MUSHI_TAGLINE_V2.northStar}\n`)
  })

  it('carries the not-an-offer disclaimer', () => {
    expect(flat).toMatch(/not an offer to sell, or a solicitation of an offer to buy, any security/i)
  })

  it('never states a raise amount, valuation or terms', () => {
    expect(flat).not.toMatch(/\b(raising|valuation|pre-money|post-money|SAFE note|cap table)\b.*\$\d/i)
    expect(flat).not.toMatch(/\$\d[\d,.]*\s*(k|m|million)\b.*\b(round|raise|seed)\b/i)
  })

  it('routes contact to the product inbox (docs/adr/0015)', () => {
    expect(investors).toContain('mailto:kensaurus@gmail.com')
    expect(investors).not.toMatch(/support@kensaur\.us/)
  })
})

describe('landing real-diagnosis card', () => {
  it('says the report is a sample and the diagnosis can be wrong', () => {
    expect(LANDING_REAL_DIAGNOSIS.provenance).toMatch(/sample we wrote/i)
    expect(LANDING_REAL_DIAGNOSIS.provenance).toMatch(/can be wrong/i)
  })

  it('marks every trim with an ellipsis', () => {
    for (const field of [LANDING_REAL_DIAGNOSIS.report, LANDING_REAL_DIAGNOSIS.rootCause]) {
      expect(field).toContain('…')
    }
  })
})
