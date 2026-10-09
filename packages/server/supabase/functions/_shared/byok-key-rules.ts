/**
 * FILE: packages/server/supabase/functions/_shared/byok-key-rules.ts
 * PURPOSE: One rule table for what a pasted BYOK key should look like, and
 *          one normalizer for what people paste (`OPENAI_API_KEY=sk-…`,
 *          `export X="sk-ant-…"`, quotes, a trailing newline).
 *
 *          The server applies it before anything reaches Vault, so a raw
 *          curl call is cleaned the same way the console form is. The admin
 *          console keeps a byte-identical copy of everything below the
 *          BODY marker in `apps/admin/src/lib/byokKeyRules.ts` so it can say
 *          the same thing before a request is sent. Parity is enforced by
 *          `packages/server/src/__tests__/byok-key-rules.test.ts` and
 *          `apps/admin/src/lib/byokKeyRules.test.ts`.
 *
 *          No imports, so vitest and Deno can both load it.
 */

// ---- BODY: keep identical with apps/admin/src/lib/byokKeyRules.ts ----

/** A provider whose keys have a prefix we can confirm. */
interface ByokKeyRule {
  /** Name used in messages ("This looks like an Anthropic key"). */
  name: string;
  /** Accepted prefixes for this provider's own row. */
  prefixes: readonly string[];
  /** Shown when a value for this row has none of the prefixes. */
  missingPrefix: string;
  /** Values people paste here by mistake, with a specific reason. */
  lookalikes?: ReadonlyArray<{ prefix: string; message: string }>;
}

/**
 * Prefix rules per provider slug. Cursor and Browserbase are absent on
 * purpose: their key formats are not confirmed, so no prefix is enforced.
 */
const BYOK_KEY_RULES: Readonly<Record<string, ByokKeyRule>> = {
  anthropic: {
    name: 'Anthropic',
    prefixes: ['sk-ant-'],
    missingPrefix: 'An Anthropic key starts with "sk-ant-". Copy it from console.anthropic.com/settings/keys.',
  },
  openai: {
    name: 'OpenAI',
    prefixes: ['sk-'],
    missingPrefix: 'An OpenAI key starts with "sk-" (project keys start with "sk-proj-").',
  },
  openrouter: {
    name: 'OpenRouter',
    prefixes: ['sk-or-'],
    missingPrefix: 'An OpenRouter key starts with "sk-or-". Create one at openrouter.ai/settings/keys.',
  },
  firecrawl: {
    name: 'Firecrawl',
    prefixes: ['fc-'],
    missingPrefix: 'A Firecrawl key starts with "fc-". Copy it from firecrawl.dev/app/api-keys.',
  },
  supabase: {
    name: 'Supabase',
    prefixes: ['sbp_'],
    missingPrefix:
      'A Supabase access token starts with "sbp_". Create one at supabase.com/dashboard/account/tokens.',
    lookalikes: [
      {
        prefix: 'sb_secret_',
        message:
          'This is a Supabase project secret key, not an access token. Create an access token (it starts with "sbp_") at supabase.com/dashboard/account/tokens.',
      },
      {
        prefix: 'sb_publishable_',
        message:
          'This is a Supabase publishable key, not an access token. Create an access token (it starts with "sbp_") at supabase.com/dashboard/account/tokens.',
      },
      {
        prefix: 'eyJ',
        message:
          'This is a Supabase project JWT (anon or service_role key), not an access token. Create an access token (it starts with "sbp_") at supabase.com/dashboard/account/tokens.',
      },
    ],
  },
};

/**
 * Prefixes that identify a provider, longest first so `sk-ant-` wins over
 * `sk-`. `generic` marks a prefix too broad to accuse a value of belonging
 * elsewhere when the target row has no rule of its own.
 */
const KEY_SIGNATURES: ReadonlyArray<{
  prefix: string;
  name: string;
  row: string;
  generic?: boolean;
}> = [
  { prefix: 'sk-proj-', name: 'OpenAI', row: 'openai' },
  { prefix: 'sk-ant-', name: 'Anthropic', row: 'anthropic' },
  { prefix: 'sk-or-', name: 'OpenRouter', row: 'openrouter' },
  { prefix: 'sbp_', name: 'Supabase', row: 'supabase' },
  { prefix: 'fc-', name: 'Firecrawl', row: 'firecrawl' },
  { prefix: 'sk-', name: 'OpenAI', row: 'openai', generic: true },
];

const ROW_NAME: Readonly<Record<string, string>> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  openrouter: 'OpenRouter',
  firecrawl: 'Firecrawl',
  supabase: 'Supabase',
};

function article(name: string): string {
  return /^[AEIOU]/.test(name) ? 'an' : 'a';
}

type SecretPasteResult =
  | { ok: true; value: string; removed: string[] }
  | { ok: false; message: string };

/**
 * Clean a pasted secret: strip a leading `NAME=` or `export NAME=`, quotes
 * or backticks around the value, and surrounding whitespace and newlines.
 * Anything left that still contains whitespace is rejected rather than
 * guessed at. `removed` names what was stripped (never the secret itself)
 * so the console can tell the user.
 */
function normalizeSecretPaste(raw: string): SecretPasteResult {
  let value = raw.trim();
  const removed: string[] = [];

  const assignment = /^(export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*/.exec(value);
  if (assignment && value.length > assignment[0].length) {
    removed.push(`${assignment[1] ? 'export ' : ''}${assignment[2]}=`);
    value = value.slice(assignment[0].length).trim();
  }

  const first = value.charAt(0);
  if (value.length >= 2 && (first === '"' || first === "'" || first === '`') && value.endsWith(first)) {
    removed.push('the quotes around it');
    value = value.slice(1, -1).trim();
  }

  if (!value) return { ok: false, message: 'Paste the API key.' };
  if (/\s/.test(value)) {
    return {
      ok: false,
      message: "The key has a space or line break in the middle. Copy it again from the provider's dashboard.",
    };
  }
  return { ok: true, value, removed };
}

/**
 * Check a normalized key against the row it was pasted into. Returns a
 * plain-English message, or null when the value is acceptable. Providers
 * without a rule only get the wrong-provider check, on distinctive prefixes.
 */
function checkByokKeyFormat(
  provider: string,
  key: string,
  _opts: { baseUrl?: string | null } = {},
): string | null {
  const rule = BYOK_KEY_RULES[provider];

  for (const lookalike of rule?.lookalikes ?? []) {
    if (key.startsWith(lookalike.prefix)) return lookalike.message;
  }

  const signature = KEY_SIGNATURES.find((s) => key.startsWith(s.prefix));
  if (signature && signature.row !== provider && (rule || !signature.generic)) {
    const row = ROW_NAME[signature.row] ?? signature.name;
    return `This looks like ${article(signature.name)} ${signature.name} key — paste it in the ${row} row.`;
  }

  if (!rule) return null;
  if (!rule.prefixes.some((prefix) => key.startsWith(prefix))) return rule.missingPrefix;
  return null;
}

/**
 * The one entry point the console form and every server write path use:
 * normalize the paste, bound its length, then check it against the row.
 * On success `value` is what gets stored and `removed` names what was
 * stripped. On failure `message` is the plain sentence to show under the
 * key field.
 */
export function prepareByokSecret(
  provider: string,
  raw: unknown,
  opts: { baseUrl?: string | null } = {},
): SecretPasteResult {
  const pasted = normalizeSecretPaste(typeof raw === 'string' ? raw : '');
  if (!pasted.ok) return pasted;
  if (pasted.value.length < 8) {
    return { ok: false, message: 'That key looks too short. Paste the full key from the provider.' };
  }
  if (pasted.value.length > 4096) {
    return { ok: false, message: 'That is too long to be an API key. Paste only the key.' };
  }
  const formatError = checkByokKeyFormat(provider, pasted.value, opts);
  return formatError ? { ok: false, message: formatError } : pasted;
}
