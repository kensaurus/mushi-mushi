export const editorialTokens = {
  paper: '#f8f4ed',
  ink: '#0e0d0b',
  vermillion: '#e03c2c',
  fontDisplay:
    '"Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Cambria, Georgia, "Times New Roman", serif',
  fontMono: 'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, "Liberation Mono", monospace',
}

/**
 * Canonical brand asset paths (relative to this package's src/).
 * Import these constants when referencing SVG logos in code so any
 * rename or refactor shows up as a type error everywhere at once.
 */
export const BRAND_ASSETS = {
  /** Full horizontal wordmark — stamp + "Mushi Mushi" text (240×56) */
  logoWordmark: new URL('./logo.svg', import.meta.url).pathname,
  /** Wordmark for dark/inverted surfaces (240×56) */
  logoWordmarkDark: new URL('./logo-dark.svg', import.meta.url).pathname,
  /** Wide single-line banner with tagline (540×64) */
  logoWide: new URL('./logo-wide.svg', import.meta.url).pathname,
  /** Standalone 虫 stamp mark — 512×512, for plugin icons and favicons */
  logoMark: new URL('./logo-mark.svg', import.meta.url).pathname,
}

/**
 * Canonical name for the public tester bounty marketplace.
 * Use this constant instead of hard-coding on any UI surface, doc, or copy.
 * Full name: "Mushi Bounties" — sub-product of mushi-mushi for crowd-testing.
 * Short name: "Bounties" — inside the console where the mushi- prefix is implied.
 */
export const MUSHI_BOUNTIES_NAME = {
  /** Full product name — use in landing pages, press, partner docs, OG tags. */
  full: 'Mushi Bounties',
  /** Short form — use inside the admin console, nav items, breadcrumbs. */
  short: 'Bounties',
  /** URL slug — use in route paths, slugs, href attributes. */
  slug: 'bounties',
  /** 5-word pitch — use in hero eyebrows, email subjects, social captions. */
  pitch: 'Earn rewards. Find real bugs.',
  /** Sub-tagline — parallels MUSHI_TAGLINE.spine, use as section labels. */
  spine: 'crowd-testing powered by the evolution loop',
}

/**
 * Legacy tagline ladder (v1) — Sentry-contrast / evolution loop.
 *
 * COMPARISON-TABLES-ONLY. Allowed exclusively inside a Sentry comparison
 * table or a second-screen objection-handler — never as a hero, eyebrow,
 * sub-hero, README opener, npm description, or social bio. Primary surfaces
 * MUST lead with MUSHI_TAGLINE_V2. CI (`scripts/check-tagline-consistency.mjs`)
 * requires the v2 hero on every primary README and treats these strings as
 * supporting copy only.
 *
 * @deprecated Do not use on any primary surface. Prefer MUSHI_TAGLINE_V2.
 */
export const MUSHI_TAGLINE_LEGACY = {
  full: 'Sentry sees what code throws. Mushi sees what users feel — and closes the loop with AI.',
  short: 'Bug reports that close themselves.',
  micro: 'Capture. Classify. Fix.',
  mark: '虫虫',
  spine: 'the evolution loop for AI-assisted software',
}

/**
 * Primary tagline ladder (v2) — the comprehension layer for AI-built apps.
 * Import and use these on README headers, landing H1, docs landing, npm.
 * The canonical identity lives in /VISION.md (the constitution); this ladder
 * is the compressed propagation of its north-star sentence. See
 * docs/marketing/VOICE.md.
 */
export const MUSHI_TAGLINE_V2 = {
  /**
   * North star — the full sentence (VISION.md §1.3). Every other field below is
   * a compression of this. Use on the about/concept pages where there's room.
   */
  northStar:
    'Your AI shipped it. Mushi tells you why it broke — in plain English, in your editor, with the fix ready to go — so a bug costs you five minutes instead of your whole afternoon.',
  /**
   * One-liner — the compressed north-star for fixed-width fields: GitHub repo
   * description, npm `description`, og:description fallback. Keep these byte-for-
   * byte identical across surfaces (the consistency check enforces it).
   */
  oneLiner:
    'Know why your AI-built app broke — plain-English diagnosis + ready fix, in your editor. Open source. Sentry optional.',
  /** Hero — README headers, landing H1, docs landing. */
  hero: 'Your AI wrote it. Mushi tells you why it broke.',
  /** Lead paragraph directly under hero. */
  subHero:
    'Plain-English diagnosis + a ready-to-apply fix, right inside Cursor and Claude Code — so a bug costs you five minutes, not your whole afternoon.',
  /** Eyebrow, npm category line, llms.txt. The category we own (VISION.md §1.5). */
  category: 'The comprehension layer for AI-built apps',
  /** og:description, slide headers. */
  micro: 'Know why. Fix fast.',
  mark: '虫虫',
}

/**
 * Canonical tagline ladder — the single source of truth for primary copy.
 *
 * Every field resolves to the v2 ladder. `legacy` is the ONLY place v1 forms
 * live, and they are for comparison tables / objection-handlers only (see
 * MUSHI_TAGLINE_LEGACY). Import `MUSHI_TAGLINE` (or `MUSHI_TAGLINE_V2`) on
 * every README header, landing H1, docs landing, npm description, and social
 * bio so a rename propagates everywhere at once.
 */
export const MUSHI_TAGLINE = {
  northStar: MUSHI_TAGLINE_V2.northStar,
  oneLiner: MUSHI_TAGLINE_V2.oneLiner,
  full: MUSHI_TAGLINE_V2.hero,
  short: MUSHI_TAGLINE_V2.micro,
  micro: MUSHI_TAGLINE_V2.micro,
  mark: MUSHI_TAGLINE_V2.mark,
  spine: MUSHI_TAGLINE_V2.category,
  subHero: MUSHI_TAGLINE_V2.subHero,
  legacy: MUSHI_TAGLINE_LEGACY,
}

/**
 * Open-source positioning ladder — the "powerhouse" proof points.
 *
 * Mushi competes for trust the way Supabase and Grafana do: a genuinely open,
 * self-hostable core with no lock-in, dogfooded on real apps. Import these on
 * the README badge row, landing trust strip, docs open-source page, and any
 * surface that needs to say "this is genuinely open." Keep the claims true —
 * if the self-host path or license split changes, change it here first.
 */
/**
 * Verified production URLs — single source of truth for listings, SDK defaults,
 * docs generators, and CI guards. Do not point cold discovery at unverified
 * `*.mushimushi.dev` hosts. See docs/marketing/canonical-urls.md.
 */
export const MUSHI_CANONICAL_URLS = {
  home: 'https://kensaur.us/mushi-mushi',
  docs: 'https://kensaur.us/mushi-mushi/docs',
  admin: 'https://kensaur.us/mushi-mushi/admin',
  connect: 'https://kensaur.us/mushi-mushi/docs/connect',
  mcpQuickstart: 'https://kensaur.us/mushi-mushi/docs/quickstart/mcp',
  api: 'https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/api',
  mcp: 'https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/mcp',
  mcpLean:
    'https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/mcp?features=triage,fixes,inventory,setup,docs',
  hostedMcp: 'https://kensaur.us/mushi-mushi/hosted-mcp/',
  schemaBase: 'https://kensaur.us/mushi-mushi/schemas',
  repo: 'https://github.com/kensaurus/mushi-mushi',
}

export const MUSHI_OSS = {
  /** Trust strip — one line, README/landing/docs. */
  trustStrip: 'MIT-licensed SDKs · self-hostable · no second LLM key',
  /** License split, stated plainly. Open-core: AGPL core + commercial EE. */
  license: 'SDKs MIT · server AGPLv3 · enterprise edition commercial',
  /** Self-host promise (Langfuse-style). */
  selfHost: 'Self-host the whole stack with one command.',
  /** No-lock-in promise (Supabase-style). */
  noLockIn: 'Your reports, your keys, your repo — no lock-in.',
  /** Dogfood proof (Langfuse "it observes its own LLM calls"). */
  dogfood: 'Mushi runs on Mushi — we catch our own bugs with it.',
}
