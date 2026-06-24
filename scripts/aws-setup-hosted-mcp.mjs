/**
 * FILE: scripts/aws-setup-hosted-mcp.mjs
 * PURPOSE: Idempotently wire kensaur.us/mushi-mushi/hosted-mcp → Supabase MCP
 *          + origin RFC 9728 PRM for Smithery publisher OAuth discovery.
 *
 * RUN: node scripts/aws-setup-hosted-mcp.mjs
 * ENV: AWS credentials (OIDC role locally or AWS_ACCESS_KEY_ID), optional
 *      CLOUDFRONT_DISTRIBUTION_ID (default E246VQ1C9QYZVB)
 */

import { execSync } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const DIST_ID = process.env.CLOUDFRONT_DISTRIBUTION_ID || process.env.CF_DIST_ID || 'E246VQ1C9QYZVB'
const SUPABASE_HOST = 'dxptnwrhwsqckaftyymj.supabase.co'
const SUPABASE_ORIGIN_ID = 'supabase-hosted-mcp'
const S3_ORIGIN_ID = 'kensaur.us/mushi-mushi'
const HOSTED_MCP_PATTERN = '/mushi-mushi/hosted-mcp*'
const WELLKNOWN_PATTERN = '/.well-known/oauth-protected-resource/mushi-mushi/hosted-mcp*'
const ROUTER_FN = 'mushi-mushi-hosted-mcp-router'
const WELLKNOWN_FN = 'mushi-mushi-hosted-mcp-wellknown'

function aws(cmd) {
  return JSON.parse(execSync(`aws ${cmd} --output json 2>&1`, { encoding: 'utf8' }))
}

function awsRaw(cmd) {
  return execSync(`aws ${cmd} 2>&1`, { encoding: 'utf8' })
}

function publishFunction(name, comment, file) {
  const configPath = join(tmpdir(), `${name}-config.json`)
  writeFileSync(configPath, JSON.stringify({ Comment: comment, Runtime: 'cloudfront-js-2.0' }))
  const configFile = configPath.replace(/\\/g, '/')

  let existing = ''
  try {
    existing = execSync(
      `aws cloudfront describe-function --name ${name} --region us-east-1 --query ETag --output text`,
      { encoding: 'utf8' },
    ).trim()
  } catch {
    existing = ''
  }
  if (existing && existing !== 'None') {
    execSync(
      `aws cloudfront update-function --name ${name} --if-match ${existing} --function-config file://${configFile} --function-code fileb://${file} --region us-east-1`,
      { stdio: 'inherit' },
    )
  } else {
    execSync(
      `aws cloudfront create-function --name ${name} --function-config file://${configFile} --function-code fileb://${file} --region us-east-1`,
      { stdio: 'inherit' },
    )
  }
  const etag = execSync(
    `aws cloudfront describe-function --name ${name} --region us-east-1 --query ETag --output text`,
    { encoding: 'utf8' },
  ).trim()
  execSync(`aws cloudfront publish-function --name ${name} --if-match ${etag} --region us-east-1`, {
    stdio: 'inherit',
  })
  return execSync(
    `aws cloudfront describe-function --name ${name} --stage LIVE --region us-east-1 --query FunctionSummary.FunctionMetadata.FunctionARN --output text`,
    { encoding: 'utf8' },
  ).trim()
}

function fnAssoc(arn) {
  return {
    Quantity: 1,
    Items: [{ FunctionARN: arn, EventType: 'viewer-request' }],
  }
}

console.log('Publishing CloudFront Functions…')
const routerArn = publishFunction(
  ROUTER_FN,
  'Proxy /mushi-mushi/hosted-mcp to Supabase MCP + kensaur.us OAuth metadata',
  'scripts/cloudfront-mushi-hosted-mcp-router.js',
)
const wellknownArn = publishFunction(
  WELLKNOWN_FN,
  'Origin RFC 9728 PRM for Smithery (kensaur.us)',
  'scripts/cloudfront-mushi-hosted-mcp-wellknown.js',
)
console.log(`  ${ROUTER_FN}: ${routerArn}`)
console.log(`  ${WELLKNOWN_FN}: ${wellknownArn}`)

console.log(`Fetching distribution ${DIST_ID}…`)
const distResp = aws(`cloudfront get-distribution-config --id ${DIST_ID} --region us-east-1`)
const etag = distResp.ETag
const config = distResp.DistributionConfig

const origins = config.Origins?.Items ?? []
if (!origins.some((o) => o.Id === SUPABASE_ORIGIN_ID)) {
  console.log(`Adding custom origin ${SUPABASE_ORIGIN_ID}…`)
  origins.push({
    Id: SUPABASE_ORIGIN_ID,
    DomainName: SUPABASE_HOST,
    OriginPath: '/functions/v1/mcp',
    CustomHeaders: { Quantity: 0 },
    CustomOriginConfig: {
      HTTPPort: 80,
      HTTPSPort: 443,
      OriginProtocolPolicy: 'https-only',
      OriginSslProtocols: { Quantity: 1, Items: ['TLSv1.2'] },
      OriginReadTimeout: 30,
      OriginKeepaliveTimeout: 5,
    },
    ConnectionAttempts: 3,
    ConnectionTimeout: 10,
    OriginShield: { Enabled: false },
  })
  config.Origins = { Quantity: origins.length, Items: origins }
}

const mushiBehavior = config.CacheBehaviors.Items.find((cb) => cb.PathPattern === '/mushi-mushi/*')
if (!mushiBehavior) {
  console.error('ERROR: missing /mushi-mushi/* cache behavior to clone')
  process.exit(1)
}

const existing = new Set(config.CacheBehaviors.Items.map((cb) => cb.PathPattern))
const toAdd = []

if (!existing.has(WELLKNOWN_PATTERN)) {
  toAdd.push({
    ...JSON.parse(JSON.stringify(mushiBehavior)),
    PathPattern: WELLKNOWN_PATTERN,
    TargetOriginId: S3_ORIGIN_ID,
    MinTTL: 0,
    DefaultTTL: 0,
    MaxTTL: 86400,
    FunctionAssociations: fnAssoc(wellknownArn),
  })
}

if (!existing.has(HOSTED_MCP_PATTERN)) {
  toAdd.push({
    ...JSON.parse(JSON.stringify(mushiBehavior)),
    PathPattern: HOSTED_MCP_PATTERN,
    TargetOriginId: SUPABASE_ORIGIN_ID,
    MinTTL: 0,
    DefaultTTL: 0,
    MaxTTL: 0,
    AllowedMethods: {
      Quantity: 7,
      Items: ['GET', 'HEAD', 'OPTIONS', 'PUT', 'POST', 'PATCH', 'DELETE'],
      CachedMethods: { Quantity: 2, Items: ['GET', 'HEAD'] },
    },
    FunctionAssociations: fnAssoc(routerArn),
  })
}

if (toAdd.length === 0) {
  console.log('Hosted MCP cache behaviors already present. Done.')
  process.exit(0)
}

console.log(`Adding behaviors: ${toAdd.map((b) => b.PathPattern).join(', ')}`)
config.CacheBehaviors.Items = [...toAdd, ...config.CacheBehaviors.Items]
config.CacheBehaviors.Quantity = config.CacheBehaviors.Items.length

const tmpDir = join(tmpdir(), 'mushi-cf-hosted-mcp')
mkdirSync(tmpDir, { recursive: true })
const tmpFile = join(tmpDir, 'cf-update-config.json')
writeFileSync(tmpFile, JSON.stringify(config))

console.log('Updating CloudFront distribution…')
const result = JSON.parse(
  awsRaw(
    `cloudfront update-distribution --id ${DIST_ID} --if-match ${etag} --distribution-config file://${tmpFile.replace(/\\/g, '/')} --region us-east-1`,
  ),
)
console.log(`SUCCESS — status ${result.Distribution?.Status ?? 'InProgress'}`)
console.log('Invalidate + verify (~5 min propagation):')
console.log('  aws cloudfront create-invalidation --distribution-id', DIST_ID, '--paths "/mushi-mushi/hosted-mcp*" "/.well-known/oauth-protected-resource/mushi-mushi/hosted-mcp*" --region us-east-1')
console.log('  curl -sS https://kensaur.us/.well-known/oauth-protected-resource/mushi-mushi/hosted-mcp')
console.log('  curl -sS https://kensaur.us/mushi-mushi/hosted-mcp/')
console.log('Smithery publish URL: https://kensaur.us/mushi-mushi/hosted-mcp/')
