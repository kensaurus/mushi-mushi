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

const tmpDir = process.env.TEMP || process.env.TMPDIR || '/tmp'
const outFile = path.join(tmpDir, 'existing-docs-router.js')
const normOutFile = outFile.replace(/\\/g, '/')

execSync(`aws cloudfront get-function --name mushi-mushi-docs-router --region us-east-1 ${normOutFile}`, { env: e })
console.log(fs.readFileSync(outFile, 'utf8'))
