export declare const editorialTokens: {
  readonly paper: '#f8f4ed'
  readonly ink: '#0e0d0b'
  readonly vermillion: '#e03c2c'
  readonly fontDisplay: string
  readonly fontMono: string
}

export declare const MUSHI_BOUNTIES_NAME: {
  /** Full product name — landing pages, press, partner docs, OG tags. */
  readonly full: string
  /** Short form — admin console, nav items, breadcrumbs. */
  readonly short: string
  /** URL slug — route paths, slugs, href attributes. */
  readonly slug: string
  /** 5-word pitch — hero eyebrows, email subjects, social captions. */
  readonly pitch: string
  /** Sub-tagline — section labels, parallels MUSHI_TAGLINE.spine. */
  readonly spine: string
}

/** @deprecated COMPARISON-TABLES-ONLY. Never on a primary surface — use MUSHI_TAGLINE_V2. */
export declare const MUSHI_TAGLINE_LEGACY: {
  readonly full: string
  readonly short: string
  readonly micro: string
  readonly mark: string
  readonly spine: string
}

export declare const MUSHI_TAGLINE_V2: {
  readonly hero: string
  readonly subHero: string
  readonly category: string
  readonly micro: string
  readonly mark: string
}

export declare const MUSHI_TAGLINE: {
  readonly full: string
  readonly short: string
  readonly micro: string
  readonly mark: string
  readonly spine: string
  readonly subHero: string
  readonly legacy: typeof MUSHI_TAGLINE_LEGACY
}

/** Open-source positioning ladder — Langfuse/Supabase-style proof points. */
export declare const MUSHI_OSS: {
  /** Trust strip — one line, README/landing/docs. */
  readonly trustStrip: string
  /** License split, stated plainly. */
  readonly license: string
  /** Self-host promise. */
  readonly selfHost: string
  /** No-lock-in promise. */
  readonly noLockIn: string
  /** Dogfood proof. */
  readonly dogfood: string
}
