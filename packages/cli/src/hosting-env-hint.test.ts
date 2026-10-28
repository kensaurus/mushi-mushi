import { describe, expect, it } from 'vitest';
import { envVarNames, hostingEnvHint } from './hosting-env-hint';

const NEXT_BLOCK = [
  'NEXT_PUBLIC_MUSHI_PROJECT_ID=7c3e2b9a-0000-4000-8000-000000000001',
  'NEXT_PUBLIC_MUSHI_API_KEY=mushi_live_supersecretvalue',
].join('\n');

describe('envVarNames', () => {
  it('takes the names before = and nothing after', () => {
    expect(envVarNames(NEXT_BLOCK)).toEqual(['NEXT_PUBLIC_MUSHI_PROJECT_ID', 'NEXT_PUBLIC_MUSHI_API_KEY']);
    expect(envVarNames('MUSHI_PROJECT_ID=a\n\n# c\nMUSHI_API_ENDPOINT=https://x')).toEqual([
      'MUSHI_PROJECT_ID',
      'MUSHI_API_ENDPOINT',
    ]);
  });
});

describe('hostingEnvHint', () => {
  const hint = hostingEnvHint(NEXT_BLOCK, '.env.local');

  it('names every variable and the file that holds the values, but never a value', () => {
    expect(hint).toContain('NEXT_PUBLIC_MUSHI_PROJECT_ID');
    expect(hint).toContain('NEXT_PUBLIC_MUSHI_API_KEY');
    expect(hint).toContain('.env.local');
    expect(hint).not.toContain('mushi_live_supersecretvalue');
    expect(hint).not.toContain('7c3e2b9a');
  });

  it('says where to add them on Vercel and Netlify, and to redeploy', () => {
    expect(hint).toMatch(/Vercel: .*Settings → Environment Variables/);
    expect(hint).toContain('vercel env add NEXT_PUBLIC_MUSHI_PROJECT_ID production');
    expect(hint).toMatch(/Netlify: .*Project configuration → Environment variables/);
    expect(hint).toContain('netlify env:set NEXT_PUBLIC_MUSHI_API_KEY');
    expect(hint).toMatch(/redeploy/i);
  });

  it('sends Lovable and Bolt to the script-tag page, which needs no variables', () => {
    expect(hint).toContain('https://kensaur.us/mushi-mushi/docs/quickstart/lovable-bolt');
  });
});
