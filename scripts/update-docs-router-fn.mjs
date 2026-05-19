import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function parseEnvFile () {
  const out = {}
  for (const raw of fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const idx = line.indexOf('=')
    if (idx === -1) continue
    out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim().replace(/^["']|["']$/g, '')
  }
  return out
}

const cfg = parseEnvFile()
const e = { ...process.env, AWS_ACCESS_KEY_ID: cfg.AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY: cfg.AWS_SECRET_ACCESS_KEY, AWS_REGION: 'us-east-1' }

// Updated function: trailing slash on non-root paths redirects to strip the slash,
// because `trailingSlash: false` in Next.js generates admin.html not admin/index.html.
const updatedCode = `/**
 * FILE: cloudfront-mushi-docs-router.js
 * PURPOSE: CloudFront Function (viewer-request) — maps clean URLs to the
 *          static export emitted by \`next build\` for the docs site at /mushi-mushi/docs/.
 *
 * RULES:
 * - URI is the docs root (/mushi-mushi/docs or /docs) without slash → 301 add trailing slash
 * - URI is the docs root WITH slash (/mushi-mushi/docs/) → serve index.html
 * - URI is a non-root path ending with /  → 301 strip the trailing slash
 *   (next.config: trailingSlash:false emits admin.html, NOT admin/index.html)
 * - URI has a file extension → pass through (assets, JSON, images)
 * - URI has no extension → append .html (clean URL → static file)
 */
function handler(event) {
  var request = event.request;
  var uri = request.uri;

  // 1. Docs root without trailing slash — redirect to canonical /mushi-mushi/docs/
  if (uri === '/mushi-mushi/docs' || uri === '/docs') {
    return {
      statusCode: 301,
      statusDescription: 'Moved Permanently',
      headers: {
        'location': { value: uri + '/' },
        'cache-control': { value: 'public, max-age=300' },
      },
    };
  }

  // 2a. Docs root with trailing slash — serve the folder index
  if (uri === '/mushi-mushi/docs/') {
    request.uri = '/mushi-mushi/docs/index.html';
    return request;
  }

  // 2b. Non-root path with trailing slash — strip it (301).
  //     trailingSlash:false means pages are emitted as page.html, not page/index.html.
  if (uri.charAt(uri.length - 1) === '/') {
    return {
      statusCode: 301,
      statusDescription: 'Moved Permanently',
      headers: {
        'location': { value: uri.slice(0, -1) },
        'cache-control': { value: 'public, max-age=300' },
      },
    };
  }

  // 3. Has a file extension: pass through (assets, JSON, sitemap, _pagefind, etc.)
  if (/\\.[a-zA-Z0-9]+$/.test(uri)) {
    return request;
  }

  // 4. Clean URL with no extension: append .html so S3 finds the static export.
  request.uri = uri + '.html';
  return request;
}`

const tmpDir = process.env.TEMP || process.env.TMPDIR || '/tmp'
const fnFile = path.join(tmpDir, 'mushi-docs-router-updated.js')
const cfgFile = path.join(tmpDir, 'mushi-docs-router-cfg.json')
fs.writeFileSync(fnFile, updatedCode, 'utf8')
fs.writeFileSync(cfgFile, JSON.stringify({
  Comment: 'Strip/add trailing slash correctly for trailingSlash:false static export',
  Runtime: 'cloudfront-js-2.0',
}), 'utf8')

const normFnFile = fnFile.replace(/\\/g, '/')
const normCfgFile = cfgFile.replace(/\\/g, '/')
const run = (cmd) => execSync(cmd, { env: e }).toString()

// Get current ETag
const existing = JSON.parse(run(`aws cloudfront describe-function --name mushi-mushi-docs-router --region us-east-1 --output json`))
const etag = existing.ETag

// Update and publish
const updated = JSON.parse(run(
  `aws cloudfront update-function --name mushi-mushi-docs-router --function-config file://${normCfgFile} --if-match ${etag} --function-code fileb://${normFnFile} --region us-east-1 --output json`
))
const newEtag = updated.ETag
console.log('Updated, etag:', newEtag)

const pub = JSON.parse(run(
  `aws cloudfront publish-function --name mushi-mushi-docs-router --if-match ${newEtag} --region us-east-1 --output json`
))
console.log('Published ARN:', pub.FunctionSummary.FunctionMetadata.FunctionARN)
console.log('Function is LIVE — CloudFront propagates in ~10–30s')
