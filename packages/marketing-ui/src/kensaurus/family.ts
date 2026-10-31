/**
 * Typed reader for the pinned kensaurus family slice (kensaurus-family.json,
 * next to this file).
 *
 * The slice is generated in kensaurus/kensaur.us from `src/data/family.json`
 * (served at https://kensaur.us/apps.json); its `$comment` says how to
 * refresh it. It lives beside `./spine`, not inside it, because spine-sync
 * wipes unknown files in that folder. Do not edit the JSON by hand.
 *
 * The spine (`./spine`) stays the source for the row list, names and icons;
 * the slice adds what the spine does not carry: the brand credit link and
 * the deep links (`pages`) worth showing under a sibling app.
 */
import slice from './kensaurus-family.json'

type Localized = { readonly en: string; readonly ja?: string }

export interface KensaurusFamilyPage {
  readonly url: string
  readonly label: Localized
  /** `url` with this app's UTM tags (or the bare URL for GitHub). Link to this. */
  readonly href: string
}

export interface KensaurusFamilyApp {
  readonly id: string
  readonly name: Localized
  readonly tagline: Localized
  readonly url: string
  readonly href: string
  readonly icon: string
  /** The app's id in the spine manifest, when it has one. */
  readonly spineId?: string
  readonly pages: readonly KensaurusFamilyPage[]
}

export interface KensaurusFamily {
  readonly updated: string
  readonly app: string
  readonly brand: {
    readonly name: string
    readonly site: string
    readonly org: string
    readonly credit: Localized
    /** The hub with this app's UTM tags. */
    readonly href: string
  }
  readonly related: readonly KensaurusFamilyApp[]
}

export const KENSAURUS_FAMILY: KensaurusFamily = slice

/** Deep links for a spine app, from the slice's related list (empty when it has none). */
export function familyPagesFor(spineId: string, limit = 2): readonly KensaurusFamilyPage[] {
  const app = KENSAURUS_FAMILY.related.find((entry) => entry.spineId === spineId)
  return app ? app.pages.slice(0, limit) : []
}
