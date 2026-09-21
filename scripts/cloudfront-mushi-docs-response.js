/**
 * FILE: cloudfront-mushi-docs-response.js
 * PURPOSE: CloudFront Function (viewer-response) for the docs site at
 *          /mushi-mushi/docs/*. Adds security headers and tags the `.txt`
 *          RSC payloads noindex.
 *
 * WHAT THIS FUNCTION CANNOT DO: CloudFront never invokes viewer-response
 * functions when the origin answers 400 or higher
 * (https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/edge-function-restrictions-all.html#function-restrictions-status-codes).
 * An earlier version synthesized an editorial 404 body here; it never ran,
 * and missing pages kept serving the S3 website endpoint's NoSuchKey page
 * with no security headers. Missing pages are handled at the origin and the
 * cache behavior instead, by scripts/aws-configure-docs-errors.mjs:
 *   - the bucket's website ErrorDocument is the export's own 404.html;
 *   - a response headers policy (which CloudFront applies to every status)
 *     carries the headers from buildSecurityHeaders() below, read from this
 *     file so the two cannot drift.
 * deploy-docs.yml smoke-checks both after every deploy.
 *
 * ASSOCIATIONS:
 * - Attached to the `/mushi-mushi/docs/*` cache behavior (S3 origin) on
 *   viewer-response. Republished by deploy-docs.yml on every docs deploy.
 */

function buildSecurityHeaders() {
  return {
    'x-content-type-options': { value: 'nosniff' },
    'x-frame-options': { value: 'SAMEORIGIN' },
    'referrer-policy': { value: 'strict-origin-when-cross-origin' },
    'permissions-policy': { value: 'camera=(), microphone=(), geolocation=()' },
    'strict-transport-security': { value: 'max-age=63072000; includeSubDomains; preload' },
    'content-security-policy': {
      value: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https://*.supabase.co; connect-src 'self' https://*.supabase.co; frame-src 'none'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'"
    },
  };
}

function handler(event) {
  var response = event.response;
  var request = event.request;

  response.headers = response.headers || {};
  var security = buildSecurityHeaders();
  for (var key in security) {
    response.headers[key] = security[key];
  }

  // Tag Nextra's `.txt` mirror files (e.g. /mushi-mushi/docs/admin.txt,
  // /mushi-mushi/docs/quickstart/react.txt) as `noindex, nofollow`. Each
  // `.txt` file is the React Server Component payload Next.js emits next
  // to the `.html` page so client-side navigation can hydrate without a
  // full page fetch. The payload embeds the entire `pageMap` with raw
  // unprefixed routes — `{"name":"fine-tuning","route":"/admin/fine-tuning"}`
  // and so on — because Next.js prepends `basePath` at runtime. Googlebot
  // fetches these `.txt` files (their MIME type is text/plain, they're
  // linked from the HTML for hydration) and parses the embedded route
  // strings as URLs to crawl, ending up at https://kensaur.us/admin/...,
  // https://kensaur.us/v1/reports, https://kensaur.us/quickstart/svelte,
  // etc. — none of which exist. That accounts for the 33 "Not found (404)"
  // entries Google Search Console flagged for kensaur.us on 2026-05-07.
  //
  // X-Robots-Tag is the right lever here (not robots.txt) because:
  //   1. We still WANT the LLM-friendly `.txt` mirrors served — they're
  //      Nextra's "copy as markdown" feature for ChatGPT/Claude users.
  //      robots.txt would also stop AI crawlers from fetching them.
  //   2. X-Robots-Tag works on non-HTML responses where a `<meta robots>`
  //      tag has no effect (per Google's documentation).
  //   3. Already-indexed URLs get dropped on the next recrawl, which
  //      robots.txt alone cannot do (it stops crawling, not indexing).
  // https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag#xrobotstag
  if (/\.txt$/.test(request.uri)) {
    response.headers['x-robots-tag'] = { value: 'noindex, nofollow' };
  }

  return response;
}
