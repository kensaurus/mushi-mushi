# Next.js Pages → App Router

Source: https://kensaur.us/mushi-mushi/docs/migrations/nextjs-pages-to-app-router

---
title: 'Next.js Pages → App Router'
---

# Next.js Pages → App Router

 

Move a Next.js Pages-Router app to the App Router incrementally. The two
routers can coexist (the App Router takes precedence for matching routes),
so you don't need a flag day.

This guide focuses on the **Mushi-specific** bits — provider placement,
CSP for static export, server-component vs client-component boundaries.
For the framework-level migration mechanics see the
[official Next.js migration guide](https://nextjs.org/docs/app/building-your-application/upgrading/app-router-migration).

  **Same Mushi project, same API key.** The provider import changes from
  `pages/_app.tsx` to `app/providers.tsx`, but everything downstream of it
  works the same.

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
    { id: 'create-app-dir', label: 'Create the app/ directory alongside pages/', content: <>Both routers can run side-by-side. Routes in app/ take precedence; routes only in pages/ keep working.</> },
    { id: 'layout', label: 'Create app/layout.tsx (the new root)', content: {`// app/layout.tsx

  return (
    
      
        {children}
      
    
  )
}`} },
    { id: 'mushi-provider', label: 'Create app/providers.tsx with the Mushi provider', content: {`// app/providers.tsx
'use client'   // <-- REQUIRED — MushiProvider uses React state

  return (
    
      {children}
    
  )
}`} },
    { id: 'remove-old-app', label: 'Delete pages/_app.tsx (only AFTER you have an app/layout.tsx)', content: <>Once app/layout.tsx exists, Next.js routes through it. Leaving pages/_app.tsx in place causes confusing dual-mounts of the Mushi provider.</> },
    { id: 'port-routes', label: 'Port routes one at a time', content: <>For each route under pages/, create the equivalent under app/ (e.g. pages/about.tsx → app/about/page.tsx). Delete the pages/ file only after the app/ version is verified.</> },
    { id: 'data-fetching', label: 'Convert data fetching to Server Components', content: <>Most getServerSideProps calls become async function Page(). Mushi's web SDK still runs client-side, so useMushi() only works inside 'use client' components — read user info on the server, pass via props, then call Mushi from the client child.</> },
    { id: 'csp', label: 'Update CSP for App Router', content: <>If you ship a strict CSP, App Router uses different chunk URLs than Pages. See the Next.js App Router CSP integration for the Mushi-specific connect-src and script-src rules.</> },
    { id: 'static-export', label: 'Re-test static export (if applicable)', content: <>App Router supports output: 'export' as of Next 14, but with constraints (no Server Actions, no dynamic routes without generateStaticParams). See Next.js static export.</> },
    { id: 'verify', label: 'Smoke-test on every primary route', content: <>Open the floating Mushi widget, submit a test report from each major page; confirm metadata.url on the report shows the correct App Router path.</> },
  ]}
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
client component. That's expected — Mushi captures user-side context
(console, network, screenshot) which only exists in the browser.

If you need user-facing context inside a Server Component (e.g. to
pre-render a "Report a problem with this article" button with a
contextual route), pass the data down as props and let the client child
call Mushi:

```tsx
// app/articles/[slug]/page.tsx (Server Component)
export default async function Page({ params }: { params: { slug: string } }) {
  const article = await fetchArticle(params.slug)
  return 
}

// app/articles/[slug]/ArticleReportButton.tsx (Client Component)
'use client'

  const { submit } = useMushiReport()
  return  submit({ description: 'Article issue', metadata: { articleId } })}>Report
}
```

## Common gotchas

- **Two providers mounted.** If you forget to delete `pages/_app.tsx` after
  creating `app/layout.tsx`, both run, which double-fires events. Always
  remove the old one in the same PR.
- **`useMushi()` in a Server Component.** Build error. Add `'use client'`
  to the file or move the hook into a child client component.
- **Stale env vars after rename.** App Router enforces the
  `NEXT_PUBLIC_*` prefix more strictly than Pages did; non-prefixed
  vars are now strictly server-only. Rename if migrating from a Pages
  app that relied on `process.env.MUSHI_*`.

## References

- [Official Next.js App Router migration guide](https://nextjs.org/docs/app/building-your-application/upgrading/app-router-migration)
- [Next.js App Router + CSP integration](/sdks/nextjs-app-router-csp)
- [Next.js static export integration](/sdks/nextjs-static-export)
- [`@mushi-mushi/react` SDK reference](/sdks/react)
