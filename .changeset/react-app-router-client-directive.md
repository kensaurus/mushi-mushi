---
'@mushi-mushi/react': patch
---

Next.js App Router works without a wrapper. Both bundles now open with `'use client'`, so importing `<MushiProvider>` into a Server Component no longer breaks the build. The README's App Router example uses the `app/providers.tsx` pattern that `npx mushi-mushi` generates, which is also the place for callbacks such as `beforeSend`.
