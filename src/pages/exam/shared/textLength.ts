/**
 * Codepoint-safe string length.
 *
 * Every character limit in the exam specs is stated in 자 (Korean characters):
 * "80~150자", "250자 이내", "행당 최대 120자". A Hangul syllable is one codepoint
 * but `String.length` counts UTF-16 units, so plain `.length` is correct for
 * BMP Hangul yet wrong the moment an emoji or a rare CJK ideograph appears.
 * Count code points so the counter shown to the candidate always matches the
 * limit the grader applies.
 */
export const charLen = (s: string) => Array.from(s ?? '').length;
