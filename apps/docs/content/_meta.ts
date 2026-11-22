// Sidebar layout for kensaur.us/mushi-mushi/docs. Top-down is the journey of a
// first-time visitor (non-technical visitor audit, 2026-11-11): what it is and
// what it costs → set it up → your situation → developer and self-host
// reference. Keys are URL slugs other pages link to: reorder and retitle, never
// rename a key.
export default {
  index: {
    title: 'Welcome',
    display: 'hidden',
    /* `breadcrumb: false`  — the hero <h1> already names the page; the
     *   "Welcome / Mushi Mushi" stack on top of "Mushi · 虫々 · little bug
     *   helper" is chrome tautology (NN/g H2 hidden failure mode). Suppress.
     * `timestamp: false`   — the landing isn't a docs article so the "Last
     *   updated on …" footer is noise. Sub-pages keep the default.
     * `toc: false`         — the page is short enough to scan without a
     *   right-rail outline; freeing that column gives the hero room to
     *   breathe at 1024-1280 widths.
     * `sidebar: false`     — GTM plan (Workstream B §1c): the landing is a
     *   conversion surface, not a docs article. The docs rail read as
     *   "portfolio side project"; the hero CTAs and navbar carry the nav.
     *   Same for `pricing` below. Nextra 4 per-page option. */
    theme: {
      layout: 'full',
      breadcrumb: false,
      timestamp: false,
      toc: false,
      sidebar: false,
      // The landing is a product page; "Copy page" is a docs-article tool.
      copyPage: false,
    },
  },

  '-- Start here': { type: 'separator', title: 'Start here' },
  'what-is-mushi-mushi': 'What is Mushi Mushi?',
  // Readable without signup or install (owner, 2026-10-27; ADR 0052).
  demo: 'See a sample',
  'how-it-works': 'How it works (video)',
  'who-its-for': 'Who it’s for',
  // Conversion surface — same sidebar-off treatment as the landing (see `index`).
  pricing: { title: 'Pricing', theme: { sidebar: false } },
  glossary: 'Glossary',
  // One page in Japanese for solo developers in Japan (re-audit 2026-11-11).
  // A plain page, not an i18n route: the rest of the docs stay English.
  ja: '日本語',

  '-- Set it up': { type: 'separator', title: 'Set it up' },
  quickstart: 'Quickstart',
  'what-it-does': 'What else it does',
  cloud: 'Mushi Mushi Cloud',

  '-- Your situation': { type: 'separator', title: 'Your situation' },
  'use-cases': 'Use cases',

  '-- Compare': { type: 'separator', title: 'Compare' },
  compare: 'Compare with other tools',

  '-- For developers': { type: 'separator', title: 'For developers' },
  connect: { title: 'Connect your AI code editor', href: '/connect' },
  concepts: 'Concepts',
  sdks: 'SDK reference',
  migrations: 'Migration guides',
  integrations: 'Integrations',
  plugins: 'Plugin marketplace',
  admin: 'Admin console',

  '-- Advanced': { type: 'separator', title: 'Advanced: run it yourself' },
  'self-hosting': 'Self-hosting',
  operating: 'Operating (maintainers)',
  security: 'Security & compliance',

  '-- Reference': { type: 'separator', title: 'Reference' },
  changelog: { title: 'Changelog', theme: { toc: false } },
  roadmap: 'Roadmap',
  open: { title: 'Open metrics', theme: { toc: false } },
  legal: 'Legal',
  'launch-week': { title: 'Launch Week', theme: { toc: false } },
  blog: { title: 'Blog', theme: { toc: false } },
  github: { title: 'GitHub ↗', href: 'https://github.com/kensaurus/mushi-mushi' },
}
