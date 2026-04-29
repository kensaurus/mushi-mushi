/**
 * FILE: apps/docs/app/[[...mdxPath]]/page.tsx
 * PURPOSE: Nextra v4 catch-all gateway for the `content/` directory.
 *
 * Boilerplate from https://nextra.site/docs/file-conventions/content-directory
 * — routes every URL not handled by another `app/` segment into the
 * matching MDX file under `apps/docs/content/`. Without it, Next.js
 * generates only the 404 page and `output: 'export'` ships an empty site.
 *
 * Translated into the project's TypeScript style + the existing
 * `mdx-components.tsx` import path.
 */

import { generateStaticParamsFor, importPage } from 'nextra/pages'
import { useMDXComponents as getMDXComponents } from '../../mdx-components'

export const generateStaticParams = generateStaticParamsFor('mdxPath')

export async function generateMetadata(props: { params: Promise<{ mdxPath?: string[] }> }) {
  const params = await props.params
  const { metadata } = await importPage(params.mdxPath)
  return metadata
}

const Wrapper = getMDXComponents().wrapper

export default async function Page(props: { params: Promise<{ mdxPath?: string[] }> }) {
  const params = await props.params
  const result = await importPage(params.mdxPath)
  // Nextra exposes default + toc + metadata + sourceCode but doesn't
  // ship richer types here; mirror the reference shape one-for-one.
  const MDXContent = result.default as (innerProps: {
    params: { mdxPath?: string[] }
  }) => React.ReactNode
  return (
    <Wrapper
      toc={(result as { toc: unknown }).toc as never}
      metadata={(result as { metadata: unknown }).metadata as never}
      sourceCode={(result as { sourceCode: string }).sourceCode}
    >
      <MDXContent params={params} />
    </Wrapper>
  )
}
