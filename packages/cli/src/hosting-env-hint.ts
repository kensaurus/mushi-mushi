/**
 * FILE: packages/cli/src/hosting-env-hint.ts
 * PURPOSE: The wizard's last word on env vars (critical audit 2026-10-27,
 *          "fix the first ten minutes"): installs stalled on localhost
 *          because .env.local never reaches the deployed site. After writing
 *          the file, `mushi init` prints the exact variable names and where
 *          to add them on Vercel and Netlify, and sends Lovable / Bolt users
 *          to the script-tag page (those builders have no env vars for the
 *          browser).
 *
 * Names only: values stay in the env file and are never printed here.
 */

const LOVABLE_BOLT_DOCS = 'https://kensaur.us/mushi-mushi/docs/quickstart/lovable-bolt';

/** @internal Exported for unit tests. Variable names in a `NAME=value` block, in order; comments and blanks skipped. */
export function envVarNames(block: string): string[] {
  return block
    .split('\n')
    .map((line) => /^([A-Z_][A-Z0-9_]*)=/.exec(line.trim())?.[1])
    .filter((name): name is string => Boolean(name));
}

/** The note printed after the env file is written: names, file, and where they go when deployed. */
export function hostingEnvHint(envBlock: string, envFile: string): string {
  const names = envVarNames(envBlock);
  const first = names[0] ?? 'MUSHI_PROJECT_ID';
  const last = names[names.length - 1] ?? first;
  return [
    `Your deployed site needs these too. The values are in ${envFile}; copy them from there:`,
    ...names.map((n) => `  ${n}`),
    '',
    `Vercel: Project → Settings → Environment Variables, or \`vercel env add ${first} production\` (it asks for the value).`,
    `Netlify: Project configuration → Environment variables, or \`netlify env:set ${last} "<value>"\`.`,
    'Then redeploy: a NEXT_PUBLIC_ / VITE_ variable only reaches the site on the next build.',
    `Lovable or Bolt: no variables needed; paste the script tag instead: ${LOVABLE_BOLT_DOCS}`,
  ].join('\n');
}
