/**
 * FILE: scripts/aws-attach-apex-redirect.mjs
 * PURPOSE: Idempotently add CloudFront cache behaviors for every apex-domain
 *          route prefix so the mushi-mushi-apex-redirect function can 301
 *          dead links to /mushi-mushi/docs/<path> or /mushi-mushi/admin/<path>.
 *
 * RUN: node scripts/aws-attach-apex-redirect.mjs
 * ENV: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, CLOUDFRONT_DISTRIBUTION_ID (or CF_DIST_ID)
 */

import { execSync } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const DIST_ID = process.env.CLOUDFRONT_DISTRIBUTION_ID || process.env.CF_DIST_ID || 'E246VQ1C9QYZVB'
const FN_ARN = 'arn:aws:cloudfront::590715976857:function/mushi-mushi-apex-redirect'
const MUSHI_ORIGIN_ID = 'kensaur.us/mushi-mushi'

/** Expand a prefix into exact + wildcard cache behavior patterns. */
function expandPrefix(prefix) {
  if (prefix.endsWith('/*')) {
    return [prefix]
  }
  return [prefix, `${prefix}/*`]
}

// Admin SPA — mirrors SPA_PREFIXES in cloudfront-mushi-apex-redirect.js.
const SPA_PATTERNS = [
  '/reports/*',
  '/reports',
  '/dashboard',
  '/dashboard/*',
  '/inbox',
  '/inbox/*',
  '/login',
  '/projects',
  '/projects/*',
  '/settings',
  '/settings/*',
  '/fixes',
  '/fixes/*',
  '/graph',
  '/graph/*',
  '/inventory',
  '/inventory/*',
  '/billing',
  '/billing/*',
  '/organization',
  '/organization/*',
  '/users',
  '/users/*',
  '/notifications',
  '/notifications/*',
  '/integrations',
  '/marketplace',
  '/marketplace/*',
  '/mcp',
  '/mcp/*',
  '/onboarding',
  '/onboarding/*',
  '/health',
  '/health/*',
  '/compliance',
  '/compliance/*',
  '/storage',
  '/storage/*',
  '/query',
  '/query/*',
  '/judge',
  '/judge/*',
  '/research',
  '/research/*',
  '/repo',
  '/repo/*',
  '/sso',
  '/sso/*',
  '/audit',
  '/audit/*',
  '/prompt-lab',
  '/prompt-lab/*',
  '/intelligence',
  '/intelligence/*',
  '/anti-gaming',
  '/anti-gaming/*',
  '/invite/*',
  '/reset-password',
  '/org/*',
]

// Docs — mirrors DOCS_EXACT + DOCS_NESTED in cloudfront-mushi-apex-redirect.js.
// NOTE: /integrations/* only (nested docs); exact /integrations stays SPA above.
const DOCS_ROOTS = [
  '/quickstart',
  '/concepts',
  '/sdks',
  '/migrations',
  '/operating',
  '/connect',
  '/security',
  '/self-hosting',
  '/plugins',
  '/blog',
  '/admin',
  '/pricing',
  '/roadmap',
  '/launch-week',
  '/changelog',
  '/cloud',
]

const DOCS_PATTERNS = [
  ...DOCS_ROOTS.flatMap(expandPrefix),
  '/integrations/*',
]

const APEX_PATTERNS = [...new Set([...DOCS_PATTERNS, ...SPA_PATTERNS])]

function aws(cmd) {
  return JSON.parse(execSync(`aws ${cmd} --output json 2>&1`, { encoding: 'utf8' }))
}
function awsRaw(cmd) {
  return execSync(`aws ${cmd} 2>&1`, { encoding: 'utf8' })
}

console.log(`Fetching distribution config for ${DIST_ID}...`)
const distResp = aws(`cloudfront get-distribution-config --id ${DIST_ID} --region us-east-1`)
const etag = distResp.ETag
const config = distResp.DistributionConfig

console.log(`Current ETag: ${etag}`)
console.log(`Current behavior count: ${config.CacheBehaviors.Quantity}`)

const mushiBehavior = config.CacheBehaviors.Items.find(cb => cb.PathPattern === '/mushi-mushi/*')
if (!mushiBehavior) {
  console.error('ERROR: Could not find /mushi-mushi/* behavior to clone settings from')
  process.exit(1)
}
console.log(`Found mushi behavior: origin=${mushiBehavior.TargetOriginId}, protocol=${mushiBehavior.ViewerProtocolPolicy}`)

const apexFnAssoc = {
  Quantity: 1,
  Items: [
    {
      FunctionARN: FN_ARN,
      EventType: 'viewer-request',
    },
  ],
}

const existingPatterns = new Set(config.CacheBehaviors.Items.map(cb => cb.PathPattern))
const newPatterns = APEX_PATTERNS.filter(p => !existingPatterns.has(p))

if (newPatterns.length === 0) {
  console.log('All apex redirect patterns already have cache behaviors. Nothing to add.')
  process.exit(0)
}

console.log(`Adding ${newPatterns.length} new cache behaviors: ${newPatterns.join(', ')}`)

const newBehaviors = newPatterns.map(pattern => ({
  ...JSON.parse(JSON.stringify(mushiBehavior)),
  PathPattern: pattern,
  TargetOriginId: MUSHI_ORIGIN_ID,
  FunctionAssociations: apexFnAssoc,
}))

config.CacheBehaviors.Items = [
  ...newBehaviors,
  ...config.CacheBehaviors.Items,
]
config.CacheBehaviors.Quantity += newBehaviors.length

const tmpDir = join(tmpdir(), 'mushi-cf-apex-redirect')
try { mkdirSync(tmpDir, { recursive: true }) } catch {}
const tmpFile = join(tmpDir, 'cf-update-config.json')
writeFileSync(tmpFile, JSON.stringify(config))
console.log(`Config written to ${tmpFile}`)

console.log('Applying distribution update...')
try {
  const result = awsRaw(
    `cloudfront update-distribution --id ${DIST_ID} --if-match ${etag} --distribution-config file://${tmpFile.replace(/\\/g, '/')} --region us-east-1`
  )
  const parsed = JSON.parse(result)
  console.log(`SUCCESS. New ETag: ${parsed.ETag}`)
  console.log(`Distribution status: ${parsed.Distribution.Status}`)
} catch (err) {
  console.error('Update failed:', err.message)
  process.exit(1)
}

console.log('\nDone. CloudFront will propagate changes in ~5 minutes.')
console.log('Verify with:')
console.log('  curl -sI https://kensaur.us/quickstart/incident-loop | grep -i location')
console.log('  curl -sI https://kensaur.us/reports/<any-uuid> | grep -i location')
