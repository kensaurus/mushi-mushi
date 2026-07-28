/**
 * Attach kensaur-www-redirect as viewer-request on every cache behavior
 * that currently has no viewer-request function (project path prefixes).
 *
 * RUN: AWS_PROFILE=sbc-deploy node scripts/aws-attach-www-redirect.mjs
 */
import { execSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIST = process.env.CLOUDFRONT_DISTRIBUTION_ID || process.env.CF_DIST_ID || 'E246VQ1C9QYZVB'
const FN = 'kensaur-www-redirect'

function awsJson(cmd) {
  return JSON.parse(
    execSync(`aws ${cmd} --output json`, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }),
  )
}

const live = awsJson(
  `cloudfront describe-function --name ${FN} --stage LIVE --region us-east-1`,
)
const arn = live.FunctionSummary?.FunctionMetadata?.FunctionARN
if (!arn) {
  console.error(`ERROR: ${FN} is not LIVE. Publish it first.`)
  process.exit(1)
}
console.log(`Function ARN: ${arn}`)

const resp = awsJson(`cloudfront get-distribution-config --id ${DIST} --region us-east-1`)
const etag = resp.ETag
const config = resp.DistributionConfig
let attached = 0

function ensureViewerRequest(behavior, label) {
  if (!behavior) return
  const items = behavior.FunctionAssociations?.Items ?? []
  if (items.some((i) => i.EventType === 'viewer-request')) {
    console.log(`skip (has viewer-request): ${label}`)
    return
  }
  const others = items.filter((i) => i.EventType !== 'viewer-request')
  behavior.FunctionAssociations = {
    Quantity: others.length + 1,
    Items: [...others, { FunctionARN: arn, EventType: 'viewer-request' }],
  }
  attached += 1
  console.log(`attach: ${label}`)
}

// Default already has kensaur-default-viewer — leave it.
for (const b of config.CacheBehaviors?.Items ?? []) {
  ensureViewerRequest(b, b.PathPattern)
}

if (attached === 0) {
  console.log('Nothing to attach.')
  process.exit(0)
}

const tmp = join(tmpdir(), 'cf-www-attach.json').replaceAll('\\', '/')
writeFileSync(tmp, JSON.stringify(config))
console.log(`Updating distribution (${attached} behaviors)...`)
const out = awsJson(
  `cloudfront update-distribution --id ${DIST} --if-match ${etag} --distribution-config file://${tmp} --region us-east-1`,
)
console.log(`Done. Status=${out.Distribution?.Status} ETag=${out.ETag}`)
