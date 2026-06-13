import { describe, it, expect } from 'vitest';
import { createPreFilter } from './pre-filter';

describe('createPreFilter', () => {
  it('passes valid descriptions', () => {
    const filter = createPreFilter();
    const result = filter.check('The checkout button does not respond when clicked');
    expect(result.passed).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('rejects descriptions shorter than minDescriptionLength', () => {
    const filter = createPreFilter({ minDescriptionLength: 10 });
    const result = filter.check('short');
    expect(result.passed).toBe(false);
    expect(result.reason).toContain('Too short');
  });

  it('rejects descriptions longer than maxDescriptionLength', () => {
    const filter = createPreFilter({ maxDescriptionLength: 20 });
    const result = filter.check('a'.repeat(21) + ' words here');
    expect(result.passed).toBe(false);
    expect(result.reason).toContain('Too long');
  });

  it('rejects repeated single character spam', () => {
    const filter = createPreFilter();
    const result = filter.check('aaaaaaaaaaaaaaaaaaa');
    expect(result.passed).toBe(false);
  });

  it('rejects all-caps shouting', () => {
    const filter = createPreFilter();
    const result = filter.check('THIS IS ALL CAPS SHOUTING TEXT');
    expect(result.passed).toBe(false);
  });

  it('rejects numbers-only input', () => {
    const filter = createPreFilter();
    const result = filter.check('12345678901234567890');
    expect(result.passed).toBe(false);
  });

  it('rejects standalone placeholder strings', () => {
    const filter = createPreFilter();
    // The whole description is just a placeholder — clearly not a real report.
    expect(filter.check('lorem ipsum').passed).toBe(false);
    expect(filter.check('lorem ipsum...').passed).toBe(false);
  });

  it('allows real reports that merely contain the word "test"', () => {
    const filter = createPreFilter();
    // Regression guard: users legitimately write "I was testing…" in real
    // reports, so "test" as a substring must not trip the spam filter.
    const result = filter.check('I was testing the checkout flow and the button froze');
    expect(result.passed).toBe(true);
  });

  it('rejects gibberish consonant-only strings', () => {
    const filter = createPreFilter();
    const result = filter.check('bcdfghjklmnpqrs more text');
    expect(result.passed).toBe(false);
  });

  it('rejects single-word descriptions', () => {
    const filter = createPreFilter();
    const result = filter.check('brokenbuttonhere');
    expect(result.passed).toBe(false);
    expect(result.reason).toContain('at least 2 words');
  });

  it('passes when spam filtering is disabled', () => {
    const filter = createPreFilter({ blockObviousSpam: false });
    const result = filter.check('aaaaaaaaaaaaaaaaaaa');
    expect(result.passed).toBe(true);
  });

  it('passes everything when filter is disabled', () => {
    const filter = createPreFilter({ enabled: false });
    const result = filter.check('x');
    expect(result.passed).toBe(true);
  });

  it('truncates long descriptions', () => {
    const filter = createPreFilter({ maxDescriptionLength: 20 });
    const result = filter.truncate('This is a very long description that exceeds limits');
    expect(result.length).toBe(23); // 20 + '...'
    expect(result.endsWith('...')).toBe(true);
  });

  it('does not truncate short descriptions', () => {
    const filter = createPreFilter({ maxDescriptionLength: 100 });
    const input = 'Short text';
    expect(filter.truncate(input)).toBe(input);
  });

  it('accepts multilingual descriptions (Japanese)', () => {
    const filter = createPreFilter();
    const result = filter.check('チェックアウトボタンが動かない 困っています');
    expect(result.passed).toBe(true);
  });
});
