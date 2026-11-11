# @mushi-mushi/marketing-ui

> **Your AI wrote it. Mushi Mushi tells you why it broke.**

Shared landing and connect-page React components.


Shared editorial marketing components used by `apps/docs` (Next.js docs site) and
`apps/admin` (Vite + react-router public pages). Components are framework-agnostic: they
get their `Link` component and URL helpers from a `<MarketingProvider>` so
the same `<MarketingFooter />`, `<LoopPipeline />` and Connect lane picker
render identically in either host.

## Setup

1. Add the dep (already wired in this monorepo via `workspace:*`):

   ```jsonc
   // apps/docs/package.json or apps/admin/package.json
   "dependencies": {
     "@mushi-mushi/marketing-ui": "workspace:*"
   }
   ```

2. Import the styles once in the host app's CSS:

   ```css
   /* apps/docs/app/globals.css OR apps/admin/src/index.css */
   @import "@mushi-mushi/marketing-ui/styles.css";
   ```

3. Tell Tailwind v4 to scan the package for utility classes:

   ```css
   @import "tailwindcss";
   @source "../../packages/marketing-ui/src/**/*.tsx";
   ```

4. Wrap the marketing surface and render:

   ```tsx
   import { MarketingProvider, LoopPipeline, MarketingFooter } from '@mushi-mushi/marketing-ui'
   import NextLink from 'next/link'   // or react-router-dom Link

   const theme = {
     Link: ({ href, children, ...rest }) => <NextLink href={href} {...rest}>{children}</NextLink>,
     urls: {
       signup: '/signup',
       login: '/login',
       loopAnchor: '#loop',
       // Pricing destination: hash anchor when the host renders a pricing
       // section on the same page, OR an absolute URL pointing at the docs
       // pricing table (`/docs/cloud#plans`). Avoid `'#pricing'` unless the
       // host actually mounts a section with that id.
       pricing: 'https://kensaur.us/mushi-mushi/docs/cloud#plans',
       docs: (path = '') => `https://kensaur.us/mushi-mushi/docs${path}`,
       repo: (path = '') => `https://github.com/kensaurus/mushi-mushi${path}`,
       contact: (subject) => subject ? `mailto:hi@kensaur.us?subject=${encodeURIComponent(subject)}` : 'mailto:hi@kensaur.us',
     },
   }

   <MarketingProvider value={theme}>
     <LoopPipeline />
     <MarketingFooter apiBaseUrl={process.env.NEXT_PUBLIC_API_BASE_URL} />
   </MarketingProvider>
   ```

## What's in the box

| Export             | Purpose                                                          |
| ------------------ | ---------------------------------------------------------------- |
| `MarketingProvider`| Provides `Link` + `urls` to the components below                 |
| `useMarketing()`   | Hook for custom marketing components in the host app             |
| `MarketingFooter`  | Footer with `<StatusPill />` and standard nav                    |
| `StatusPill`       | Standalone gateway-health probe                                  |
| `LoopPipeline`     | The bug loop in one row (docs `/concepts/closed-loop`)           |
| `ConnectLanePicker`, `useConnectSelection`, `renderConnectClientIcon` | The "pick your client, connect in one click" picker on admin and docs `/connect` |
| `KensaurusPortfolioTable`, `KENSAURUS_FAMILY` | The sibling-app table in the docs footer |

The landing canvas (`Hero`, `MushiCanvas`, `ClosingCta`, `SwitchingFromStrip`,
`PersonaTrack`, `PrivacyPosture`) was removed on 2026-11-11: no host had
mounted it since the admin public homepage was removed.

## Why this package exists

Before this package, the marketing surface lived in `apps/docs` landing components
with `next/link` and `next/dynamic` baked in. When `apps/admin` (the Vite SPA)
needed the same look at `localhost:6464`, the only options were duplication or
a refactor. This package is the refactor: one source of truth, two consumers,
zero framework lock-in.

## Caveats

- The component-driven `Link` contract is intentionally narrow: `href`,
  `className`, `children`, `aria-label`, `lang`, `onClick`. If the host needs
  something exotic (prefetch hints, scroll restoration), wrap that in the
  adapter the host passes to `<MarketingProvider>`.
- `apps/docs` keeps its own `content/index.mdx` (pricing, custom layout) — this
  package only ships the cross-app components, not the page composition.
