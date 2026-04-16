import { verifyFix } from './index.js'

const args = process.argv.slice(2)
const reportId = args.find(a => a.startsWith('--report-id='))?.split('=')[1]
const deploymentUrl = args.find(a => a.startsWith('--deployment-url='))?.split('=')[1]

if (!reportId) {
  console.error('Usage: tsx src/run.ts --report-id=<uuid> --deployment-url=<url>')
  process.exit(1)
}

const supabaseUrl = process.env.SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set')
  process.exit(1)
}

const result = await verifyFix({
  reportId,
  deploymentUrl: deploymentUrl ?? 'http://localhost:3000',
  supabaseUrl,
  supabaseServiceKey,
})

console.log(`Verification ${result.status}:`, JSON.stringify(result, null, 2))
process.exit(result.status === 'passed' ? 0 : 1)
