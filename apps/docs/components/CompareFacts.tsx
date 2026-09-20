/**
 * Building blocks for /compare/* and the how-to pages that sit beside them.
 *
 * Every number on those pages lives in content/compare/_facts.ts with the URL
 * it was read from and the date it was checked; these components only render
 * that data. A fact flagged `unverified` prints its note inline so a stale or
 * unconfirmed value can never look confirmed. Server-safe: no hooks.
 */
import type { AlternativeRow, Vendor } from '../content/compare/_facts'
import { faqPageJsonLd, type FaqEntry } from '../lib/structured-data'
import { JsonLd } from './JsonLd'

const UNVERIFIED = 'unverified — check before publishing'

/** The visible "Facts checked YYYY-MM-DD" line every compare page carries. */
export function FactsChecked({ reviewedAt, nextReviewDue }: { reviewedAt: string; nextReviewDue: string }) {
  return (
    <p className="not-prose my-4 text-sm text-mushi-ink-muted">
      Facts checked <time dateTime={reviewedAt}>{reviewedAt}</time> against the linked sources. Next review due{' '}
      <time dateTime={nextReviewDue}>{nextReviewDue}</time>. Rows marked &ldquo;{UNVERIFIED}&rdquo; could not be
      confirmed on that date.
    </p>
  )
}

/** One vendor's sourced facts: what it is, then claim / value / source rows. */
export function FactsTable({ vendor }: { vendor: Vendor }) {
  return (
    <div className="not-prose my-6">
      <p className="mb-3 text-sm text-mushi-ink-muted">
        <a href={vendor.url} rel="noopener">
          {vendor.name}
        </a>
        : {vendor.whatItIs}
      </p>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th scope="col">Claim</th>
              <th scope="col">{vendor.name}</th>
              <th scope="col">Source</th>
            </tr>
          </thead>
          <tbody>
            {vendor.facts.map((fact) => (
              <tr key={fact.claim}>
                <th scope="row" style={{ fontWeight: 600 }}>
                  {fact.claim}
                </th>
                <td>
                  {fact.value}
                  {fact.unverified ? <em> ({UNVERIFIED})</em> : null}
                </td>
                <td>
                  <a href={fact.sourceUrl} rel="noopener">
                    checked {fact.reviewedAt}
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** Six-way matrix for the "alternatives" page: one row per vendor, no highlighted column. */
export function AlternativesMatrix({ rows }: { rows: readonly AlternativeRow[] }) {
  return (
    <div className="not-prose my-6 overflow-x-auto">
      <table>
        <thead>
          <tr>
            <th scope="col">Tool</th>
            <th scope="col">Free tier</th>
            <th scope="col">Self-host</th>
            <th scope="col">AI diagnosis / fix</th>
            <th scope="col">Pick this if</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.vendor}>
              <th scope="row" style={{ fontWeight: 600 }}>
                <a href={row.url} rel="noopener">
                  {row.vendor}
                </a>
                <br />
                <a href={row.sourceUrl} rel="noopener" className="text-xs font-normal text-mushi-ink-muted">
                  source
                </a>
              </th>
              <td>{row.freeTier}</td>
              <td>{row.selfHost}</td>
              <td>{row.aiFix}</td>
              <td>{row.pickIf}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Visible FAQ + schema.org FAQPage from the same array, so the two cannot drift. */
export function FaqList({ items }: { items: readonly FaqEntry[] }) {
  return (
    <section aria-label="Frequently asked questions">
      <JsonLd data={faqPageJsonLd(items)} />
      <dl className="not-prose my-6 divide-y divide-mushi-rule rounded-md border border-mushi-rule">
        {items.map((item) => (
          <div key={item.q} className="px-4 py-3">
            <dt className="text-sm font-medium text-mushi-ink">{item.q}</dt>
            <dd className="m-0 mt-1 text-sm text-mushi-ink-muted">{item.a}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

/** The one call to action each compare page carries; `href` comes from signupUrl(slug). */
export function StartFree({ href, label = 'Start free — 50 diagnoses/mo, no card' }: { href: string; label?: string }) {
  return (
    <p className="not-prose my-6">
      <a
        href={href}
        className="inline-block rounded-md border border-mushi-vermillion px-4 py-2 text-sm font-medium text-mushi-vermillion hover:bg-mushi-paper-wash"
      >
        {label}
      </a>
    </p>
  )
}
