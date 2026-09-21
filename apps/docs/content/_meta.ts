// Sidebar layout for kensaur.us/mushi-mushi/docs. Top-down represents the journey
// from "what is Mushi" → "install" → "operate".
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
    },
  },

  '-- Get started': { type: 'separator', title: 'Get started' },
  connect: { title: 'Connect your client', href: '/connect' },
  quickstart: 'Quickstart',
  concepts: 'Concepts',

  '-- SDKs': { type: 'separator', title: 'SDKs' },
  sdks: 'SDK reference',
  migrations: 'Migration guides',

  '-- Operate': { type: 'separator', title: 'Operate Mushi' },
  admin: 'Admin console',
  cloud: 'Mushi Cloud',
  operating: 'Operating (maintainers)',
  'self-hosting': 'Self-hosting',
  security: 'Security & compliance',

  '-- Extend': { type: 'separator', title: 'Extend Mushi' },
  integrations: 'Integrations',
  plugins: 'Plugin marketplace',

  '-- Compare': { type: 'separator', title: 'Compare & use cases' },
  'use-cases': 'Use cases',
  compare: 'Compare',

  '-- Reference': { type: 'separator', title: 'Reference' },
  changelog: { title: 'Changelog', theme: { toc: false } },
  roadmap: 'Roadmap',
  // Conversion surface — same sidebar-off treatment as the landing (see `index`).
  pricing: { title: 'Pricing', theme: { sidebar: false } },
  legal: 'Legal',
  'launch-week': { title: 'Launch Week', theme: { toc: false } },
  blog: { title: 'Blog', theme: { toc: false } },
  github: { title: 'GitHub ↗', href: 'https://github.com/kensaurus/mushi-mushi' },
}
