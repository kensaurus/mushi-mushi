import { JsonLd } from './JsonLd'
import { INVESTORS_ABOUT_PAGE_JSONLD } from '../lib/structured-data'

/** /investors-only AboutPage schema — dropped into content/investors.mdx. */
export function InvestorsJsonLd() {
  return <JsonLd data={INVESTORS_ABOUT_PAGE_JSONLD} />
}
