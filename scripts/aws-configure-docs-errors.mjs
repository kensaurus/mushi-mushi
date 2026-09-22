#!/usr/bin/env node
/**
 * FILE: scripts/aws-configure-docs-errors.mjs
 * PURPOSE: Make a missing docs page a branded 404 with security headers,
 *          instead of the S3 website endpoint's NoSuchKey page (bucket key,
 *          RequestId, HostId, "An Error Occurred While Attempting to Retrieve
 *          a Custom Error Document") with none.
 *
 * WHY NOT THE DOCS RESPONSE FUNCTION: CloudFront never invokes viewer-response
 * functions when the origin answers >= 400, so no edge function on the docs
 * behavior can touch a 404. Two things that DO apply to error responses:
 *
 *   1. The origin itself. The docs origin is the S3 *website* endpoint of
 *      kensaur.us-mushi-mushi, whose ErrorDocument is `index.html` — a key
 *      that does not exist, hence the second NoSuchKey on every 404. Point it
 *      at the docs export's own 404.html (S3 serves it with status 404).
 *   2. A response headers policy on the `/mushi-mushi/docs/*` behavior.
 *      CloudFront applies it to every response it sends, whatever the status.
 *      Its values are read from buildSecurityHeaders() in
 *      cloudfront-mushi-docs-response.js, so the 2xx and 4xx headers are one
 *      source. It also strips the x-amz-* error headers that name the key.
 *
 * Distribution-level CustomErrorResponses are deliberately NOT used: they are
 * per-distribution, and this distribution serves every kensaur.us app. The
 * ErrorDocument is per-bucket, and kensaur.us-mushi-mushi also holds the
 * admin console, the testers site and /schemas — so a missing object there
 * gets the docs 404 page too. That coupling stays inside Mushi's own bucket
 * and still beats the NoSuchKey page; the response headers policy is scoped
 * to the docs behavior only.
 *
 * Idempotent: reads current state and only writes what differs.
 *
 * RUN:  node scripts/aws-configure-docs-errors.mjs [--dry-run]
 * ENV:  CLOUDFRONT_DISTRIBUTION_ID (default E246VQ1C9QYZVB)
 *       S3_BUCKET                  (default kensaur.us-mushi-mushi)
 * IAM:  s3:GetBucketWebsite, s3:PutBucketWebsite on the bucket;
 *       cloudfront:ListResponseHeadersPolicies, GetResponseHeadersPolicy,
 *       CreateResponseHeadersPolicy, UpdateResponseHeadersPolicy,
 *       GetDistributionConfig, UpdateDistribution. The GitHub deploy role
 *       (scripts/setup-aws-github-oidc.mjs) has only the last two, so this is
 *       run by an account admin, not by deploy-docs.yml.
 * VERIFY: deploy-docs.yml's "Smoke-check a missing docs page" step.
 */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { stripSource } from './build-cf-function.mjs'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))

export const DOCS_PATH_PATTERN = '/mushi-mushi/docs/*'
export const DOCS_ERROR_KEY = 'mushi-mushi/docs/404.html'
export const POLICY_NAME = 'mushi-mushi-docs-security-headers'
/** CloudFront's documented cap on the Content-Security-Policy value. */
export const CSP_MAX_CHARS = 1783

/** Headers S3 adds to error responses; the detail header names the key. */
export const REMOVED_HEADERS = [
  'server',
  'x-amz-error-code',
  'x-amz-error-message',
  'x-amz-error-detail-key',
  'x-amz-request-id',
  'x-amz-id-2',
  'x-amz-version-id',
]

const REFERRER_POLICIES = new Set([
  'no-referrer',
  'no-referrer-when-downgrade',
  'origin',
  'origin-when-cross-origin',
  'same-origin',
  'strict-origin',
  'strict-origin-when-cross-origin',
  'unsafe-url',
])

/** The docs response function's security headers, as `{ name: value }`. */
export function loadDocsSecurityHeaders(
  file = join(SCRIPT_DIR, 'cloudfront-mushi-docs-response.js'),
) {
  const src = stripSource(readFileSync(file, 'utf8'))
  // eslint-disable-next-line no-new-func
  const headers = new Function(`${src}\nreturn buildSecurityHeaders();`)()
  return Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v.value]))
}

function parseHsts(value) {
  const parts = value.split(';').map((p) => p.trim().toLowerCase())
  const maxAge = parts.find((p) => p.startsWith('max-age='))
  if (!maxAge) throw new Error(`strict-transport-security has no max-age: "${value}"`)
  return {
    AccessControlMaxAgeSec: Number(maxAge.slice('max-age='.length)),
    IncludeSubdomains: parts.includes('includesubdomains'),
    Preload: parts.includes('preload'),
    Override: true,
  }
}

/**
 * Map `{ name: value }` headers onto a CloudFront ResponseHeadersPolicyConfig.
 * Throws on a value the policy cannot express rather than dropping it.
 */
export function buildResponseHeadersPolicyConfig(headers) {
  const security = {}
  const custom = []
  for (const [name, value] of Object.entries(headers)) {
    switch (name) {
      case 'x-content-type-options':
        if (value !== 'nosniff') throw new Error(`x-content-type-options must be nosniff, got "${value}"`)
        security.ContentTypeOptions = { Override: true }
        break
      case 'x-frame-options':
        if (value !== 'DENY' && value !== 'SAMEORIGIN') {
          throw new Error(`x-frame-options must be DENY or SAMEORIGIN, got "${value}"`)
        }
        security.FrameOptions = { FrameOption: value, Override: true }
        break
      case 'referrer-policy':
        if (!REFERRER_POLICIES.has(value)) throw new Error(`unsupported referrer-policy "${value}"`)
        security.ReferrerPolicy = { ReferrerPolicy: value, Override: true }
        break
      case 'strict-transport-security':
        security.StrictTransportSecurity = parseHsts(value)
        break
      case 'content-security-policy':
        if (value.length > CSP_MAX_CHARS) {
          throw new Error(`content-security-policy is ${value.length} chars; CloudFront caps it at ${CSP_MAX_CHARS}`)
        }
        security.ContentSecurityPolicy = { ContentSecurityPolicy: value, Override: true }
        break
      default:
        custom.push({ Header: name, Value: value, Override: true })
    }
  }
  return {
    Name: POLICY_NAME,
    Comment: 'Docs security headers on every status; source: cloudfront-mushi-docs-response.js',
    SecurityHeadersConfig: security,
    CustomHeadersConfig: { Quantity: custom.length, Items: custom },
    RemoveHeadersConfig: {
      Quantity: REMOVED_HEADERS.length,
      Items: REMOVED_HEADERS.map((Header) => ({ Header })),
    },
  }
}

/**
 * The bucket website configuration with ErrorDocument pointed at the docs
 * 404 page; everything else (IndexDocument, RoutingRules) is kept.
 * Returns `null` when nothing needs to change.
 */
export function desiredWebsiteConfig(current, errorKey = DOCS_ERROR_KEY) {
  if (current?.RedirectAllRequestsTo) {
    throw new Error('bucket website redirects all requests; an ErrorDocument would never be served')
  }
  if (!current?.IndexDocument) {
    throw new Error('bucket has no website IndexDocument; is the origin still the S3 website endpoint?')
  }
  if (current.ErrorDocument?.Key === errorKey) return null
  const next = { IndexDocument: current.IndexDocument, ErrorDocument: { Key: errorKey } }
  if (current.RoutingRules?.length) next.RoutingRules = current.RoutingRules
  return next
}

/**
 * Attach `policyId` to the docs cache behavior in a distribution config.
 * Returns true when the config was changed. Refuses to replace a different
 * policy someone attached on purpose.
 */
export function attachPolicyToDocsBehavior(distConfig, policyId, pathPattern = DOCS_PATH_PATTERN) {
  const behavior = distConfig.CacheBehaviors?.Items?.find((cb) => cb.PathPattern === pathPattern)
  if (!behavior) throw new Error(`no cache behavior with PathPattern ${pathPattern}`)
  if (behavior.ResponseHeadersPolicyId === policyId) return false
  if (behavior.ResponseHeadersPolicyId) {
    throw new Error(
      `${pathPattern} already uses response headers policy ${behavior.ResponseHeadersPolicyId}; ` +
        `detach it deliberately before running this script`,
    )
  }
  behavior.ResponseHeadersPolicyId = policyId
  return true
}

function aws(args) {
  return execFileSync('aws', [...args, '--output', 'json'], { encoding: 'utf8' })
}

function awsJson(args) {
  const out = aws(args).trim()
  return out ? JSON.parse(out) : {}
}

function writeTmpJson(name, value) {
  const dir = mkdtempSync(join(tmpdir(), 'mushi-docs-errors-'))
  const file = join(dir, name)
  writeFileSync(file, JSON.stringify(value))
  return `file://${file.replace(/\\/g, '/')}`
}

function main() {
  const dryRun = process.argv.includes('--dry-run')
  const distId = process.env.CLOUDFRONT_DISTRIBUTION_ID || 'E246VQ1C9QYZVB'
  const bucket = process.env.S3_BUCKET || 'kensaur.us-mushi-mushi'
  const tag = dryRun ? '[dry-run] ' : ''

  // 1. Origin: the bucket's website ErrorDocument.
  const website = awsJson(['s3api', 'get-bucket-website', '--bucket', bucket])
  const nextWebsite = desiredWebsiteConfig(website)
  if (!nextWebsite) {
    console.log(`✓ ${bucket} ErrorDocument is already ${DOCS_ERROR_KEY}`)
  } else {
    console.log(`${tag}${bucket} ErrorDocument: ${website.ErrorDocument?.Key ?? '(none)'} → ${DOCS_ERROR_KEY}`)
    if (!dryRun) {
      aws(['s3api', 'put-bucket-website', '--bucket', bucket, '--website-configuration', writeTmpJson('website.json', nextWebsite)])
    }
  }

  // 2. Response headers policy, created or brought in line with the function.
  const policyConfig = buildResponseHeadersPolicyConfig(loadDocsSecurityHeaders())
  const listed = awsJson(['cloudfront', 'list-response-headers-policies', '--type', 'custom'])
  const existing = (listed.ResponseHeadersPolicyList?.Items ?? []).find(
    (item) => item.ResponseHeadersPolicy?.ResponseHeadersPolicyConfig?.Name === POLICY_NAME,
  )
  let policyId = existing?.ResponseHeadersPolicy?.Id
  if (!policyId) {
    console.log(`${tag}create response headers policy ${POLICY_NAME}`)
    if (!dryRun) {
      const created = awsJson(['cloudfront', 'create-response-headers-policy', '--response-headers-policy-config', writeTmpJson('policy.json', policyConfig)])
      policyId = created.ResponseHeadersPolicy.Id
    }
  } else {
    const current = awsJson(['cloudfront', 'get-response-headers-policy', '--id', policyId])
    const same =
      JSON.stringify(current.ResponseHeadersPolicy.ResponseHeadersPolicyConfig) === JSON.stringify(policyConfig)
    if (same) {
      console.log(`✓ response headers policy ${POLICY_NAME} (${policyId}) is current`)
    } else {
      console.log(`${tag}update response headers policy ${POLICY_NAME} (${policyId})`)
      if (!dryRun) {
        aws(['cloudfront', 'update-response-headers-policy', '--id', policyId, '--if-match', current.ETag, '--response-headers-policy-config', writeTmpJson('policy.json', policyConfig)])
      }
    }
  }

  // 3. Attach it to the docs behavior.
  if (!policyId) {
    console.log(`${tag}attach the new policy to ${DOCS_PATH_PATTERN}`)
    return
  }
  const dist = awsJson(['cloudfront', 'get-distribution-config', '--id', distId])
  if (!attachPolicyToDocsBehavior(dist.DistributionConfig, policyId)) {
    console.log(`✓ ${DOCS_PATH_PATTERN} already uses ${POLICY_NAME}`)
    return
  }
  console.log(`${tag}attach ${POLICY_NAME} to ${DOCS_PATH_PATTERN} on ${distId}`)
  if (!dryRun) {
    aws(['cloudfront', 'update-distribution', '--id', distId, '--if-match', dist.ETag, '--distribution-config', writeTmpJson('dist.json', dist.DistributionConfig)])
    console.log('Done. Propagation takes a few minutes; then invalidate "/mushi-mushi/docs/*".')
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main()
  } catch (err) {
    console.error(`aws-configure-docs-errors: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  }
}
