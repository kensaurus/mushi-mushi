// Sidebar layout for docs.mushimushi.dev. Top-down represents the journey
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
     *   breathe at 1024-1280 widths. */
    theme: { layout: 'full', breadcrumb: false, timestamp: false, toc: false },
  },

  '-- Get started': { type: 'separator', title: 'Get started' },
  quickstart: 'Quickstart',
  concepts: 'Concepts',

  '-- SDKs': { type: 'separator', title: 'SDKs' },
  sdks: 'SDK reference',
  migrations: 'Migration guides',

  '-- Operate': { type: 'separator', title: 'Operate Mushi' },
  admin: 'Admin console',
  cloud: 'Mushi Cloud',
  'self-hosting': 'Self-hosting',
  security: 'Security & compliance',

  '-- Extend': { type: 'separator', title: 'Extend Mushi' },
  plugins: 'Plugin marketplace',

  '-- Reference': { type: 'separator', title: 'Reference' },
  changelog: { title: 'Changelog', theme: { toc: false } },
  roadmap: 'Roadmap',
  whitepaper: { title: 'Whitepaper ↗', href: 'https://github.com/kensaurus/mushi-mushi/blob/master/MushiMushi_Whitepaper_V5.md' },
  github: { title: 'GitHub ↗', href: 'https://github.com/kensaurus/mushi-mushi' },
}
