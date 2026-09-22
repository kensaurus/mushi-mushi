'use client'

import { KENSAURUS_APPS, type KensaurusApp } from './kensaurus/spine/apps.generated'
import { goLink } from './kensaurus/spine/links'

/**
 * "More from KENSAURUS" — the cross-promo footer shown on the docs site and on
 * admin's PublicIntegrationsPage.
 *
 * SOURCE OF TRUTH: the KENSAURUS spine (ADR 0014, sourced in kensaurus/yen-yen,
 * vendored here under ./kensaurus/spine and checked against spine.lock.json).
 * This file used to carry its own hand-copied PORTFOLIO array, which drifted
 * from the manifest — stale blurbs, a missing app, and social links duplicated
 * for tsumagoi. Rows are derived from the manifest now: to change a name, icon,
 * blurb or link, edit the manifest in yen-yen and re-run the sync. Do not
 * reintroduce a local list here.
 *
 * LINKS: app rows go through the apex redirector (`goLink`), so a click is
 * attributed (`ref=mushi-mushi`) and logged as a `crosslink_click` before the
 * visitor is handed on. The hub row is a direct UTM'd URL because it *is* the
 * apex — sending it through the apex redirector would be a pointless hop.
 *
 * NO JSON-LD: this deliberately emits no ItemList. It used to, which told
 * search and answer engines that every Mushi page (docs footer, landing,
 * admin's public integrations page) was *about* a Thai course, a household
 * ledger and a camp in Gunma. Structured data on a Mushi page describes Mushi
 * (apps/docs/lib/structured-data.ts); plain links are enough for the portfolio.
 */

const CAMPAIGN = 'more-from-kensaurus'
const SELF_ID = 'mushi-mushi'
const HUB_ID = 'portfolio'

/** English copy, falling back to the first locale so a ja-first entry still renders. */
function pickCopy(copy: Readonly<Record<string, string>> | undefined): string {
  if (!copy) return ''
  return copy.en ?? Object.values(copy)[0] ?? ''
}

/**
 * The hub's UTM'd URL. Built with `URL` rather than the spine's `webLink()`
 * because the hub is the one manifest entry whose `web` already carries a query
 * (`https://kensaur.us/?view=portfolio`), and `webLink()` appends a second `?`
 * instead of `&` — it produced `...?view=portfolio?utm_source=...`. yen-yen's
 * footer hand-rolls this for the same reason. Falls back to the bare URL if the
 * manifest ever holds something `URL` cannot parse, so a render never throws.
 */
function hubHref(web: string, source: string): string {
  try {
    const url = new URL(web)
    url.searchParams.set('utm_source', source)
    url.searchParams.set('utm_medium', 'cross-promo')
    url.searchParams.set('utm_campaign', CAMPAIGN)
    return url.toString()
  } catch {
    return web
  }
}

/** The extra destinations an app lists in the manifest (tsumagoi has three). */
function extraLinks(app: KensaurusApp): ReadonlyArray<{ href: string; label: string }> {
  const extras: Array<{ href: string; label: string }> = []
  if (app.instagram) extras.push({ href: app.instagram, label: 'Instagram' })
  if (app.facebook) extras.push({ href: app.facebook, label: 'Facebook' })
  if (app.googleMaps) extras.push({ href: app.googleMaps, label: 'Maps' })
  return extras
}

export function KensaurusPortfolioTable({ utmSource }: { utmSource: string }) {
  const all = KENSAURUS_APPS as readonly KensaurusApp[]

  // Every sibling worth promoting, in manifest order. Unlike the spine's
  // `siblings()` helper this keeps sdk-only entries (cursor-kenji): Mushi's
  // readers are developers, so an editor-playbook repo is on-topic here even
  // though it is not on-topic in a consumer app's footer.
  const apps = all.filter((app) => app.id !== SELF_ID && app.role !== 'hub')
  const hub = all.find((app) => app.id === HUB_ID)

  return (
    <section aria-label="More from KENSAURUS" className="mt-6">
      <h2 className="mb-3 font-serif text-base font-semibold text-[var(--mushi-ink)]">
        More from KENSAURUS
      </h2>
      <ul className="m-0 grid list-none grid-cols-2 gap-2 p-0 sm:grid-cols-3">
        {[...apps, ...(hub ? [hub] : [])].map((app) => {
          const isHub = app.id === HUB_ID
          const href = isHub
            ? hubHref(app.web, utmSource)
            : goLink(app.id, '', { ref: utmSource, campaign: CAMPAIGN })
          const blurb = pickCopy(app.blurb) || pickCopy(app.tagline)
          const extras = extraLinks(app)

          return (
            <li key={app.id}>
              <a
                href={href}
                target="_blank"
                rel="noreferrer"
                className="flex min-h-11 items-start gap-2.5 rounded-sm px-2 py-2.5 no-underline transition hover:bg-[color:color-mix(in_srgb,var(--mushi-vermillion)_8%,transparent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--mushi-vermillion)]"
              >
                <img
                  src={app.icon}
                  width={32}
                  height={32}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="mt-0.5 h-8 w-8 shrink-0 rounded-sm object-cover"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-[var(--mushi-ink)]">
                    {app.name}
                  </span>
                  <span className="mt-0.5 line-clamp-2 block text-xs leading-normal text-[var(--mushi-ink-muted)]">
                    {blurb}
                  </span>
                </span>
              </a>
              {extras.length > 0 ? (
                <p className="mt-1 pl-10 text-xs text-[var(--mushi-ink-muted)]">
                  {extras.map((extra, i) => (
                    <span key={extra.href}>
                      {i > 0 ? ' · ' : null}
                      <a
                        href={extra.href}
                        target="_blank"
                        rel="noreferrer"
                        className="underline-offset-2 hover:text-[var(--mushi-vermillion)] hover:underline"
                      >
                        {extra.label}
                      </a>
                    </span>
                  ))}
                </p>
              ) : null}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
