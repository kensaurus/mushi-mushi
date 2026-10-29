# Next.js Pages → App Router

Source: https://kensaur.us/mushi-mushi/docs/migrations/nextjs-pages-to-app-router

---
title: 'Next.js Pages → App Router'
description: Move a Next.js app from the Pages Router to the App Router step by step. Where to mount Mushi Mushi, CSP for static export, and client component boundaries.
---

# Next.js Pages → App Router

 

Move a Next.js Pages-Router app to the App Router incrementally. The two
routers can run in the same app, one route at a time, so you don't need a
flag day. A given URL can live in only one of them.

This guide focuses on the **Mushi Mushi** bits: provider placement, CSP
for static export, and server-component vs client-component boundaries.
For the framework-level migration mechanics see the
[official Next.js migration guide](https://nextjs.org/docs/app/guides/migrating/app-router-migration).

  **Same Mushi project, same API key.** App routes get the provider from
  `app/providers.tsx`; routes still in `pages/` keep getting it from
  `pages/_app.tsx` until you move them. Everything downstream works the
  same.

## API mapping (Pages → App)

| Pages Router | App Router |
|--------------|------------|
| `pages/_app.tsx` (`` mounted here) | `app/providers.tsx` (client component) imported in `app/layout.tsx` |
| `pages/_document.tsx` | `app/layout.tsx` |
| `getServerSideProps` | Server Component fetch |
| `getStaticProps` / `getStaticPaths` | `generateStaticParams` + Server Component fetch |
| `useRouter().query` | `useSearchParams()` + `useParams()` |
| `next/head` | `metadata` export OR `` in layout |

## Migration checklist

Most major libraries (Next-Auth, SWR, react-query, framer-motion) are App Router-ready in 2026. The exceptions are anything that monkey-patches Next's internals.</> },
    { id: 'create-app-dir', label: 'Create the app/ directory alongside pages/', content: <>Both routers can run side by side. Routes only in pages/ keep working; if both directories define the same URL, Next.js reports a conflict error.</> },
    { id: 'layout', label: 'Create app/layout.tsx (the new root)', content: {`// app/layout.tsx

  return (
    
      
        {children}
      
    

}`} },
    { id: 'mushi-provider', label: 'Create app/providers.tsx with the Mushi provider', content: {`// app/providers.tsx
'use client'   // <-- REQUIRED — MushiProvider uses React state

  return (
    

    

}`} },
    { id: 'remove-old-app', label: 'Keep pages/_app.tsx until the last pages/ route is moved', content: <>app/layout.tsx applies only to routes in app/. Routes still in pages/ need pages/_app.tsx (and its MushiProvider); Next.js says to keep _app and _document while migrating and delete them once fully migrated.</> },
    { id: 'port-routes', label: 'Port routes one at a time', content: <>For each route under pages/, create the equivalent under app/ (e.g. pages/about.tsx → app/about/page.tsx) and delete the pages/ file in the same change, since the same URL can't exist in both. Check it on a preview deploy.</> },
    { id: 'data-fetching', label: 'Convert data fetching to Server Components', content: <>Most getServerSideProps calls become async function Page(). Mushi's web SDK still runs client-side, so useMushi() only works inside 'use client' components — read user info on the server, pass via props, then call Mushi from the client child.</> },
    { id: 'csp', label: 'Update CSP for App Router', content: <>If you ship a strict CSP, App Router uses different chunk URLs than Pages. See the Next.js App Router CSP integration for the Mushi-specific connect-src and script-src rules.</> },
    { id: 'static-export', label: 'Re-test static export (if applicable)', content: <>App Router supports output: 'export', with constraints (no Server Actions, no dynamic routes without generateStaticParams). See Next.js static export.</> },
    { id: 'verify', label: 'Smoke-test on every primary route', content: <>Open the floating Mushi widget, submit a test report from each major page, and confirm the report shows the correct page URL.</> },

/>

## Where to put `` (the most asked question)

**At the root of your tree, in a `'use client'` component, mounted by the
root layout.** This means:

- ✅ `app/providers.tsx` (client component) imported into `app/layout.tsx`
- ❌ Inside an individual page (loses provider context across navigations)
- ❌ As a Server Component (the SDK uses React state — must be client)

The cost of one client boundary at the root is minimal (the rest of your
tree can still be server-rendered) and it matches how Next-Auth's
`SessionProvider`, react-query's `QueryClientProvider`, and similar libs
are placed.

## Server Components and `useMushi()`

`useMushi()`, `useMushiReport()`, and the visual widget all require a
client component. That's expected: Mushi captures user-side context
(console, network, screenshot) which only exists in the browser.

If you need user-facing context inside a Server Component (e.g. to
pre-render a "Report a problem with this article" button with a
contextual route), pass the data down as props and let the client child
call Mushi:

```tsx
// app/articles/[slug]/page.tsx (Server Component)
export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params   // params is a Promise in Next.js 15+
  const article = await fetchArticle(slug)
  return <ArticleReportButton articleId={article.id} />
}

// app/articles/[slug]/ArticleReportButton.tsx (Client Component)
'use client'
import { useMushiSdk } from '@mushi-mushi/react'
export function ArticleReportButton({ articleId }: { articleId: string }) {
  const mushi = useMushiSdk()
  return <button onClick={() => void mushi?.captureEvent({ description: 'Article issue', metadata: { articleId } })}>Report</button>
}
```

## Common gotchas

- **Deleting `pages/_app.tsx` too early.** Routes still in `pages/` lose
  their providers, including Mushi's. Delete `_app` only after the last
  `pages/` route has moved.
- **Navigating between the two routers is a full page load.** The Mushi
  SDK starts again on the other side; nothing else to do.
- **`useMushi()` in a Server Component.** Build error. Add `'use client'`
  to the file or move the hook into a child client component.
- **Env vars.** Only `NEXT_PUBLIC_*` variables reach the browser, in
  both routers. If a Pages app passed a server-only `MUSHI_*` value down
  through `getServerSideProps`, rename it to `NEXT_PUBLIC_MUSHI_*` and
  read it in the client provider.

## References

- [Official Next.js App Router migration guide](https://nextjs.org/docs/app/guides/migrating/app-router-migration)
- [Next.js App Router + CSP integration](/sdks/nextjs-app-router-csp)
- [Next.js static export integration](/sdks/nextjs-static-export)
- [`@mushi-mushi/react` SDK reference](/sdks/react)
