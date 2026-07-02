// GENERATED CODE — DO NOT MODIFY BY HAND.
//
// Source of truth: packages/core/src/pii-patterns.json
// Regenerate:       node scripts/generate-flutter-pii-patterns.mjs
// CI drift gate:    pnpm check:flutter-pii-patterns
//
// Canonical PII/secret-scrubber patterns, shared with the JS/TS SDKs via
// packages/core/src/pii-scrubber.ts, so a Flutter user who pastes a Stripe
// key, an OpenAI key, a JWT, or a credit card into a bug report never ships
// it to our servers — and a future pattern update can't drift between SDKs.
// Order matters: SSN -> credit card -> vendor secret tokens -> email -> phone.
library;

final List<MapEntry<RegExp, String>> kPiiScrubPatterns =
    <MapEntry<RegExp, String>>[
  MapEntry(RegExp('\\b\\d{3}-\\d{2}-\\d{4}\\b'), '[REDACTED_SSN]'),
  MapEntry(RegExp('\\b(?:\\d[ -]*){12,18}\\d\\b'), '[REDACTED_CC]'),
  MapEntry(RegExp('\\b(?:AKIA|ASIA)[0-9A-Z]{16}\\b'), '[REDACTED_AWS_KEY]'),
  MapEntry(
    RegExp(
      '(?:aws_secret_access_key|secret_access_key)["\'\\s:=]+[A-Za-z0-9/+=]{40}\\b',
      caseSensitive: false,
    ),
    'aws_secret_access_key=[REDACTED_AWS_SECRET]',
  ),
  MapEntry(
    RegExp('\\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{24,}\\b'),
    '[REDACTED_STRIPE_KEY]',
  ),
  MapEntry(
    RegExp('\\bpk_(?:live|test)_[A-Za-z0-9]{24,}\\b'),
    '[REDACTED_STRIPE_PK]',
  ),
  MapEntry(
    RegExp('\\bxox[abpor]-[A-Za-z0-9-]{10,}\\b'),
    '[REDACTED_SLACK_TOKEN]',
  ),
  MapEntry(RegExp('\\bghp_[A-Za-z0-9]{36}\\b'), '[REDACTED_GITHUB_PAT]'),
  MapEntry(
    RegExp('\\bgithub_pat_[A-Za-z0-9_]{80,}\\b'),
    '[REDACTED_GITHUB_PAT]',
  ),
  MapEntry(
    RegExp('\\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\\b'),
    '[REDACTED_OPENAI_KEY]',
  ),
  MapEntry(
    RegExp('\\bsk-ant-[A-Za-z0-9_-]{20,}\\b'),
    '[REDACTED_ANTHROPIC_KEY]',
  ),
  MapEntry(RegExp('\\bAIza[0-9A-Za-z_-]{35}\\b'), '[REDACTED_GOOGLE_KEY]'),
  MapEntry(
    RegExp('\\beyJ[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\b'),
    '[REDACTED_JWT]',
  ),
  MapEntry(
    RegExp('\\b[A-Za-z0-9._%+\\-]+@[A-Za-z0-9.\\-]+\\.[A-Za-z]{2,}\\b'),
    '[REDACTED_EMAIL]',
  ),
  MapEntry(
    RegExp(
      '(?:\\+\\d{1,3}[\\s.-])?\\(?\\d{2,4}\\)?[\\s.-]\\d{3,4}[\\s.-]\\d{3,4}\\b',
    ),
    '[REDACTED_PHONE]',
  ),
];
