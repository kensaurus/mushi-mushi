# @mushi/verify

Playwright-based fix verification for Mushi Mushi — runs automated smoke tests on generated fixes and compares screenshots.

## How It Works

1. Loads the original bug report from Supabase (including reproduction steps)
2. Launches a Playwright browser against the deployed fix branch
3. Executes reproduction steps (navigate, click, type)
4. Takes a screenshot and compares against the baseline using pixelmatch
5. Records pass/fail result back to Supabase

## Usage

```bash
# Run via the verify script
cd packages/verify
pnpm verify
```

Or programmatically:

```ts
import { verifyFix } from '@mushi/verify'

const result = await verifyFix({
  fixAttemptId: 'fix_xxx',
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  targetUrl: 'https://preview-branch.your-app.com',
})
```

## CI Integration

The [verify-fix workflow](../../.github/workflows/verify-fix.yml) runs this automatically on deployment status events.

## License

[BSL 1.1](../server/LICENSE) — converts to Apache 2.0 on April 15, 2029.
