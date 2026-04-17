// Sidebar layout for docs.mushimushi.dev. Top-down represents the journey
// from "what is Mushi" → "install" → "operate".
export default {
  index: { title: 'Welcome', display: 'hidden', theme: { layout: 'full' } },

  '-- Get started': { type: 'separator', title: 'Get started' },
  quickstart: 'Quickstart',
  concepts: 'Concepts',

  '-- SDKs': { type: 'separator', title: 'SDKs' },
  sdks: 'SDK reference',

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
  whitepaper: { title: 'Whitepaper ↗', href: 'https://github.com/kensaurus/mushi-mushi/blob/master/MushiMushi_Whitepaper_V5.md', newWindow: true },
  github: { title: 'GitHub ↗', href: 'https://github.com/kensaurus/mushi-mushi', newWindow: true },
}
