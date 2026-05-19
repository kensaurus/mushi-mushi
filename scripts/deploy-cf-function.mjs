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
const e = {
  ...process.env,
  AWS_ACCESS_KEY_ID: cfg.AWS_ACCESS_KEY_ID,
  AWS_SECRET_ACCESS_KEY: cfg.AWS_SECRET_ACCESS_KEY,
  AWS_REGION: 'us-east-1',
}
const DIST_ID = cfg.CLOUDFRONT_DISTRIBUTION_ID || 'E246VQ1C9QYZVB'

const fnCode = `function handler(event) {
  var request = event.request;
  var uri = request.uri;
  // Redirect trailing slash to the canonical path without slash
  if (uri !== '/' && uri.endsWith('/')) {
    return {
      statusCode: 301,
      statusDescription: 'Moved Permanently',
      headers: { location: { value: uri.slice(0, -1) } }
    };
  }
  // Append .html for extensionless paths (Next.js static export)
  if (!uri.includes('.') && uri !== '/') {
    request.uri = uri + '.html';
  }
  return request;
}`

const tmpDir = process.env.TEMP || process.env.TMPDIR || '/tmp'
const fnFile = path.join(tmpDir, 'mushi-cf-fn.js')
const cfgFile = path.join(tmpDir, 'mushi-cf-fn-config.json')
fs.writeFileSync(fnFile, fnCode, 'utf8')
fs.writeFileSync(cfgFile, JSON.stringify({
  Comment: 'Strip trailing slash and append .html for docs static export',
  Runtime: 'cloudfront-js-2.0',
}), 'utf8')

// Normalise Windows paths for the AWS CLI
const normFnFile = fnFile.replace(/\\/g, '/')
const normCfgFile = cfgFile.replace(/\\/g, '/')

const run = (cmd) => execSync(cmd, { env: e }).toString()

let functionEtag
try {
  const existing = JSON.parse(run(`aws cloudfront describe-function --name mushi-docs-trailing-slash --region us-east-1 --output json`))
  functionEtag = existing.ETag
  console.log('Function exists, updating…')
  const result = JSON.parse(run(
    `aws cloudfront update-function --name mushi-docs-trailing-slash --function-config file://${normCfgFile} --if-match ${functionEtag} --function-code fileb://${normFnFile} --region us-east-1 --output json`
  ))
  functionEtag = result.ETag
  console.log('Updated, etag:', functionEtag)
} catch (_) {
  console.log('Creating new function…')
  const result = JSON.parse(run(
    `aws cloudfront create-function --name mushi-docs-trailing-slash --function-config file://${normCfgFile} --function-code fileb://${normFnFile} --region us-east-1 --output json`
  ))
  functionEtag = result.ETag
  console.log('Created, etag:', functionEtag)
}

const pubResult = JSON.parse(run(`aws cloudfront publish-function --name mushi-docs-trailing-slash --if-match ${functionEtag} --region us-east-1 --output json`))
const functionArn = pubResult.FunctionSummary.FunctionMetadata.FunctionARN
console.log('Published ARN:', functionArn)

// Associate with the distribution
const distResult = JSON.parse(run(`aws cloudfront get-distribution-config --id ${DIST_ID} --region us-east-1 --output json`))
const distEtag = distResult.ETag
const distConfig = distResult.DistributionConfig

const dcb = distConfig.DefaultCacheBehavior
if (!dcb.FunctionAssociations) dcb.FunctionAssociations = { Quantity: 0, Items: [] }
const items = (dcb.FunctionAssociations.Items || []).filter(a => a.EventType !== 'viewer-request')
items.push({ EventType: 'viewer-request', FunctionARN: functionArn })
dcb.FunctionAssociations = { Quantity: items.length, Items: items }

const distCfgFile = path.join(tmpDir, 'mushi-cf-dist-config.json')
fs.writeFileSync(distCfgFile, JSON.stringify(distConfig), 'utf8')
const normDistCfgFile = distCfgFile.replace(/\\/g, '/')

const updateResult = JSON.parse(run(
  `aws cloudfront update-distribution --id ${DIST_ID} --distribution-config file://${normDistCfgFile} --if-match ${distEtag} --region us-east-1 --output json`
))
console.log(`Distribution updated — status: ${updateResult.Distribution.Status}`)
console.log('CloudFront will propagate in ~30–60s')
