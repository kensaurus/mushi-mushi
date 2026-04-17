/**
 * FILE: cloudfront-mushi-spa-router.js
 * PURPOSE: CloudFront Function (viewer-request) that handles SPA routing for
 *          the Mushi Mushi admin console deployed at /mushi-mushi/.
 *
 * OVERVIEW:
 * - Rewrites page-route URIs (no file extension) to /mushi-mushi/index.html
 *   so React Router can handle client-side routing
 * - Leaves static asset requests (.js, .css, .png, etc.) unchanged so S3
 *   returns them directly
 *
 * DEPLOYMENT:
 * - Create as a CloudFront Function (runtime: cloudfront-js-2.0)
 * - Associate with the /mushi-mushi/* cache behavior on viewer-request
 *
 * NOTES:
 * - Vite builds with base: '/mushi-mushi/' so all asset paths are absolute
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

  // Page routes: rewrite to /mushi-mushi/index.html for React Router.
  request.uri = '/mushi-mushi/index.html';

  return request;
}
