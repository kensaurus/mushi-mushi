import 'package:flutter_test/flutter_test.dart';
import 'package:mushi_mushi/src/pii_patterns.g.dart';

/// Exercises pii_patterns.g.dart directly — generated from
/// packages/core/src/pii-patterns.json, the single source of truth shared
/// with packages/core/src/pii-scrubber.ts. These assertions mirror
/// packages/core/src/pii-scrubber.test.ts so a future pattern change that
/// breaks one SDK's behavior gets caught on both sides.
String scrub(String text) {
  var result = text;
  for (final entry in kPiiScrubPatterns) {
    result = result.replaceAll(entry.key, entry.value);
  }
  return result;
}

void main() {
  test('redacts email addresses', () {
    expect(
      scrub('Contact me at john@example.com please'),
      'Contact me at [REDACTED_EMAIL] please',
    );
  });

  test('redacts SSN patterns', () {
    expect(scrub('SSN: 123-45-6789'), 'SSN: [REDACTED_SSN]');
  });

  test('redacts credit card numbers', () {
    expect(scrub('Card: 4111 1111 1111 1111'), 'Card: [REDACTED_CC]');
  });

  test('redacts phone numbers with separators', () {
    expect(scrub('Call +1-555-123-4567'), 'Call [REDACTED_PHONE]');
  });

  test('does not redact IPs by default', () {
    expect(scrub('Server at 192.168.1.1'), 'Server at 192.168.1.1');
  });

  test('redacts AWS access keys', () {
    expect(
      // gitleaks:allow check-no-secrets: ignore-next-line -- AWS's documented fake example key, used to assert the scrubber redacts this pattern
      scrub('key is AKIAIOSFODNN7EXAMPLE'),
      'key is [REDACTED_AWS_KEY]',
    );
  });

  test('redacts AWS secret keys case-insensitively', () {
    expect(
      // gitleaks:allow check-no-secrets: ignore-next-line -- AWS's documented fake example secret, used to assert the scrubber redacts this pattern
      scrub('AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'),
      'aws_secret_access_key=[REDACTED_AWS_SECRET]',
    );
  });

  test('redacts Stripe secret keys', () {
    expect(
      scrub('sk_live_${'a' * 24}'),
      '[REDACTED_STRIPE_KEY]',
    );
  });

  test('redacts GitHub fine-grained PATs', () {
    expect(
      scrub('github_pat_${'a' * 80}'),
      '[REDACTED_GITHUB_PAT]',
    );
  });

  test('redacts OpenAI keys', () {
    expect(scrub('sk-${'a' * 20}'), '[REDACTED_OPENAI_KEY]');
  });

  test('redacts JWTs', () {
    expect(
      scrub('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc123'),
      '[REDACTED_JWT]',
    );
  });
}
