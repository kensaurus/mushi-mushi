/**
 * FILE: cloudfront-mushi-spa-router.js
 * PURPOSE: CloudFront Function (viewer-request) that handles SPA routing for
 *          the Mushi Mushi admin console deployed at /mushi-mushi/admin/.
 *
 * OVERVIEW:
 * - Rewrites page-route URIs (no file extension) to /mushi-mushi/admin/index.html
 *   so React Router can handle client-side routing
 * - Leaves static asset requests (.js, .css, .png, etc.) unchanged so S3
 *   returns them directly
 *
 * ASSOCIATIONS:
 * - This function is attached to the `/mushi-mushi/admin/*` cache behavior
 *   (S3 origin) on viewer-request. The default `/mushi-mushi/*` behavior
 *   forwards to the cloud Vercel origin and does NOT use this function —
 *   Next.js handles its own routing there.
 * - The `/mushi-mushi/docs/*` behavior uses cloudfront-mushi-docs-router.js
 *   which has slightly different rewrite rules (per-folder index.html).
 *
 * DEPLOYMENT:
 * - Create as a CloudFront Function (runtime: cloudfront-js-2.0)
 * - The deploy-admin.yml workflow updates + publishes this function on every
 *   admin deploy. It is idempotent — first run creates, subsequent runs update.
 *
 * NOTES:
 * - Vite builds with base: '/mushi-mushi/admin/' so all asset paths are absolute
 * - No route aliases needed — React Router handles all client-side routing
 * - No .well-known handlers needed — no mobile app
 */

function handler(event) {
  var request = event.request;
  var uri = request.uri;

  // Static assets: any URI with a file extension -> pass through to S3.
  if (/\.[a-zA-Z0-9]+$/.test(uri)) {
    return request;
  }

  // Page routes under /mushi-mushi/admin -> SPA index for React Router.
  request.uri = '/mushi-mushi/admin/index.html';

  return request;
}
