# @mushi-mushi/marketing-ui

Shared editorial marketing components used by `apps/cloud` (Next.js) and
`apps/admin` (Vite + react-router). Components are framework-agnostic: they
get their `Link` component and URL helpers from a `<MarketingProvider>` so
the same `<Hero />`, `<MushiCanvas />`, `<ClosingCta />`, and
`<MarketingFooter />` render identically in either host.

## Setup

1. Add the dep (already wired in this monorepo via `workspace:*`):

   ```jsonc
   // apps/cloud/package.json or apps/admin/package.json
   "dependencies": {
     "@mushi-mushi/marketing-ui": "workspace:*"
   }
   ```

2. Import the styles once in the host app's CSS:

   ```css
   /* apps/cloud/app/globals.css OR apps/admin/src/index.css */
   @import "@mushi-mushi/marketing-ui/styles.css";
   ```

3. Tell Tailwind v4 to scan the package for utility classes:

   ```css
   @import "tailwindcss";
   @source "../../packages/marketing-ui/src/**/*.tsx";
   ```

4. Wrap the marketing surface and render:

   ```tsx
   import { MarketingProvider, Hero, MushiCanvas, ClosingCta, MarketingFooter } from '@mushi-mushi/marketing-ui'
   import NextLink from 'next/link'   // or react-router-dom Link

   const theme = {
     Link: ({ href, children, ...rest }) => <NextLink href={href} {...rest}>{children}</NextLink>,
     urls: {
       signup: '/signup',
       login: '/login',
       loopAnchor: '#loop',
       pricingAnchor: '#pricing',
       docs: (path = '') => `https://kensaur.us/mushi-mushi/docs${path}`,
       repo: (path = '') => `https://github.com/kensaurus/mushi-mushi${path}`,
       contact: (subject) => subject ? `mailto:hi@kensaur.us?subject=${encodeURIComponent(subject)}` : 'mailto:hi@kensaur.us',
     },
   }

   <MarketingProvider value={theme}>
     <Hero />
     <MushiCanvas />
     <ClosingCta />
     <MarketingFooter apiBaseUrl={process.env.NEXT_PUBLIC_API_BASE_URL} />
   </MarketingProvider>
   ```

## What's in the box

| Export             | Purpose                                                          |
| ------------------ | ---------------------------------------------------------------- |
| `MarketingProvider`| Provides `Link` + `urls` to the components below                 |
| `useMarketing()`   | Hook for custom marketing components in the host app             |
| `Hero`             | Landing hero with serif H1, CTA buttons, and a sample report     |
| `MushiCanvas`      | Interactive 5-stage React Flow canvas with auto-cycle + drawer   |
| `ClosingCta`       | Bottom-of-page deploy/source CTA with bilingual kicker           |
| `MarketingFooter`  | Footer with `<StatusPill />` and standard nav                    |
| `StatusPill`       | Standalone gateway-health probe                                  |
| `SwitchingFromStrip` | "Switching from X?" row of 5 competitor chips, each linking to its docs migration guide (`/migrations/<competitor>-to-mushi`). Drop into a landing page between hero and CTA |

Plus all stage / edge / log data and TypeScript types so consumers can
extend the canvas without re-declaring them.

## Why this package exists

Before this package, the marketing surface lived in `apps/cloud/app/_components/`
with `next/link` and `next/dynamic` baked in. When `apps/admin` (the Vite SPA)
needed the same look at `localhost:6464`, the only options were duplication or
a refactor. This package is the refactor: one source of truth, two consumers,
zero framework lock-in.

## Caveats

- `MushiCanvas` lazy-loads `@xyflow/react` + `framer-motion` via React.lazy
  so first-paint stays light. The fallback (`StaticStageStrip`) is also the
  no-JS / `prefers-reduced-motion` shape — render it as-is, no extra wiring.
- The component-driven `Link` contract is intentionally narrow: `href`,
  `className`, `children`, `aria-label`, `lang`, `onClick`. If the host needs
  something exotic (prefetch hints, scroll restoration), wrap that in the
  adapter the host passes to `<MarketingProvider>`.
- `apps/cloud` keeps its own `app/page.tsx` (pricing, custom layout) — this
  package only ships the cross-app components, not the page composition.
