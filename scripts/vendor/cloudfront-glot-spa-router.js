/**
 * Vendored from glot.it/scripts/cloudfront-spa-router.js — sync when glot.it
 * well-known or SPA routing changes. Used by cloudfront-kensaur-default-viewer.js.
 */
var SECURITY_HEADERS = {
  'x-content-type-options': { value: 'nosniff' },
  'x-frame-options': { value: 'SAMEORIGIN' },
  'referrer-policy': { value: 'strict-origin-when-cross-origin' },
  'permissions-policy': { value: 'camera=(), microphone=(self), geolocation=()' },
};

var ROUTE_ALIASES = {
  "/glot-it/word-bank/": "/glot-it/words/",
  "/glot-it/exercises/speed-run/": "/glot-it/exercises/",
  "/glot-it/exercises/challenge/": "/glot-it/exercises/",
  "/glot-it/exercises/listening/": "/glot-it/exercises/",
  "/glot-it/exercises/match-pairs/": "/glot-it/exercises/",
  "/glot-it/exercises/tricky-words/": "/glot-it/exercises/",
  "/glot-it/exercises/pronunciation/": "/glot-it/exercises/",
  "/glot-it/exercises/tone-pairs/": "/glot-it/exercises/",
  "/glot-it/learn/": "/glot-it/practice/",
};

function handler(event) {
  var request = event.request;
  var uri = request.uri;

  if (uri === '/.well-known/assetlinks.json') {
    return {
      statusCode: 200,
      statusDescription: 'OK',
      headers: Object.assign({}, SECURITY_HEADERS, {
        'content-type': { value: 'application/json' },
        'cache-control': { value: 'public, max-age=3600' }
      }),
      body: '[{"relation":["delegate_permission/common.handle_all_urls","delegate_permission/common.get_login_creds"],"target":{"namespace":"android_app","package_name":"com.glotit.app","sha256_cert_fingerprints":["E5:C6:00:49:37:74:2E:0B:A1:2C:7D:D6:D4:D5:43:96:C0:B5:2D:A0:FE:E6:6B:C9:0F:51:76:46:CE:6C:E7:E2"]}},{"relation":["delegate_permission/common.handle_all_urls","delegate_permission/common.get_login_creds"],"target":{"namespace":"android_app","package_name":"app.yenyen","sha256_cert_fingerprints":["3B:86:59:D6:2E:49:20:99:8C:0F:28:EB:F1:BF:33:2F:47:4B:B0:57:C8:1F:CF:EA:CB:0E:3F:BA:5E:7E:A6:F4","DE:E8:A6:19:89:E4:02:B0:50:E0:AE:ED:E8:AE:CE:6C:41:4F:64:12:05:FD:1D:FF:06:C5:E1:3F:5E:68:D6:13"]}}]'
    };
  }
  if (uri === '/.well-known/apple-app-site-association') {
    return {
      statusCode: 200,
      statusDescription: 'OK',
      headers: Object.assign({}, SECURITY_HEADERS, {
        'content-type': { value: 'application/json' },
        'cache-control': { value: 'public, max-age=3600' }
      }),
      body: '{"applinks":{"apps":[],"details":[{"appID":"8X8U3NV59F.com.glotit.app","paths":["*"]}]},"webcredentials":{"apps":["8X8U3NV59F.com.glotit.app"]},"appclips":{"apps":["8X8U3NV59F.com.glotit.app.Clip"]}}'
    };
  }

  if (/\.[a-zA-Z0-9]+$/.test(uri)) {
    return request;
  }

  if (!uri.endsWith("/")) {
    uri += "/";
  }

  if (ROUTE_ALIASES[uri]) {
    uri = ROUTE_ALIASES[uri];
  }

  request.uri = uri + "index.html";

  return request;
}
