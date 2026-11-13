/**
 * FILE: scripts/aws-setup-hosted-mcp.mjs
 * PURPOSE: Idempotently publish the code of the two hosted-MCP CloudFront
 *          Functions: kensaur.us/mushi-mushi/hosted-mcp → Supabase MCP, and the
 *          origin RFC 9728 PRM + RFC 8414 AS metadata (path-inserted well-known
 *          URIs) for MCP client and Smithery OAuth discovery.
 *
 *          Code only. It never reads or writes the kensaur.us distribution
 *          (E246VQ1C9QYZVB): the behaviours, the Supabase origin and the
 *          function associations are owned by kensaurus/kensaur.us `infra/edge/`.
 *
 * RUN: node scripts/aws-setup-hosted-mcp.mjs
 * ENV: AWS credentials (OIDC role locally or AWS_ACCESS_KEY_ID)
 */

import { execSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const SUPABASE_ORIGIN_ID = 'supabase-hosted-mcp'
const HOSTED_MCP_PATTERN = '/mushi-mushi/hosted-mcp*'
const WELLKNOWN_PATTERN = '/.well-known/oauth-protected-resource/mushi-mushi/hosted-mcp*'
// The MCP SDK fetches this URL first when discovering the authorization
// server; without a behavior it falls through to the default S3 origin (404).
const AS_WELLKNOWN_PATTERN = '/.well-known/oauth-authorization-server/mushi-mushi/hosted-mcp*'
const ROUTER_FN = 'mushi-mushi-hosted-mcp-router'
const WELLKNOWN_FN = 'mushi-mushi-hosted-mcp-wellknown'

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

console.log('Publishing CloudFront Functions…')
const routerArn = publishFunction(
  ROUTER_FN,
  'Proxy /mushi-mushi/hosted-mcp to Supabase MCP + kensaur.us OAuth metadata',
  'scripts/cloudfront-mushi-hosted-mcp-router.js',
)
const wellknownArn = publishFunction(
  WELLKNOWN_FN,
  'Origin RFC 9728 PRM + RFC 8414 AS metadata (kensaur.us)',
  'scripts/cloudfront-mushi-hosted-mcp-wellknown.js',
)
console.log(`  ${ROUTER_FN}: ${routerArn}`)
console.log(`  ${WELLKNOWN_FN}: ${wellknownArn}`)

console.log('Done. Code only: this script never writes the distribution config.')
console.log('The behaviours that run these functions are owned by kensaurus/kensaur.us infra/edge/:')
console.log(`  ${HOSTED_MCP_PATTERN} (origin ${SUPABASE_ORIGIN_ID}) → ${ROUTER_FN}`)
console.log(`  ${WELLKNOWN_PATTERN} → ${WELLKNOWN_FN}`)
console.log(`  ${AS_WELLKNOWN_PATTERN} → ${WELLKNOWN_FN}`)
console.log('Verify (~5 min propagation): node scripts/verify-hosted-mcp.mjs')
console.log('Smithery publish URL: https://kensaur.us/mushi-mushi/hosted-mcp/')
