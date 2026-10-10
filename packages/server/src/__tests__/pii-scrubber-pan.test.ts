/**
 * The PAN pattern was narrowed to 12–18 digits to match an old comment, but
 * ISO/IEC 7812 card numbers run to 19 digits (UnionPay, Maestro, some Visa),
 * so a 19-digit PAN reached the LLM unredacted, or with its tail left over.
 */
import { describe, expect, it } from 'vitest'
import { scrubPii } from '../../supabase/functions/_shared/pii-scrubber.ts'

describe('scrubPii card numbers', () => {
  it('redacts a 19-digit PAN, unspaced and spaced, with nothing left over', () => {
    expect(scrubPii('card 6212345678901234567 end')).toBe('card [REDACTED_CC] end')
    expect(scrubPii('card 6212 3456 7890 1234 567 end')).toBe('card [REDACTED_CC] end')
  })

  it('still redacts 12- and 16-digit PANs', () => {
    expect(scrubPii('a 4111 1111 1111 1111 b')).toBe('a [REDACTED_CC] b')
    expect(scrubPii('a 501234567890 b')).toBe('a [REDACTED_CC] b')
  })
})
