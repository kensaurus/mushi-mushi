import { JsonLd } from '../JsonLd'
import { SOFTWARE_APPLICATION_JSONLD } from '../../lib/structured-data'

/** Landing-page-only SoftwareApplication schema — dropped into content/index.mdx. */
export function LandingJsonLd() {
  return <JsonLd data={SOFTWARE_APPLICATION_JSONLD} />
}
