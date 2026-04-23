# @mushi-mushi/verify

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
import { verifyFix } from '@mushi-mushi/verify'

const result = await verifyFix({
  reportId: 'rep_xxx',
  fixAttemptId: 'fa_xxx', // optional — correlates the run to a fix_attempts row
  deploymentUrl: 'https://preview-branch.your-app.com',
  supabaseUrl: process.env.SUPABASE_URL!,
  supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
  // Optional: override reproduction_steps with attach-time steps.
  steps: [
    'navigate /checkout',
    { action: 'click', target: 'Pay now' },
    'assert "Order confirmed" is visible',
  ],
})
```

### Attach-time steps

By default `verifyFix` replays `reports.reproduction_steps`. Pass `steps`
to override them at call-time — useful when an agent attaches a custom
regression probe alongside its fix PR. Strings are run through the same
natural-language parser as repro steps; structured `{ action, target?, value? }`
descriptors skip parsing and dispatch directly.

### Attempt correlation

Pass `fixAttemptId` to link this verification to the `fix_attempts` row
that produced the PR. The result is mirrored into
`fix_attempts.verify_steps` (JSONB) so the judge and admin console can
answer "did attempt X actually pass verification?" without a fragile
time-based join. See migration `20260422120000_verify_steps_correlation.sql`
for the schema.

## CI Integration

The [verify-fix workflow](../../.github/workflows/verify-fix.yml) runs this automatically on deployment status events.

## License

[BSL 1.1](../server/LICENSE) — converts to Apache 2.0 on April 15, 2029.
