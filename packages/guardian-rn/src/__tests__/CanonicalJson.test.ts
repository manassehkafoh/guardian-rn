import { canonicalJson } from '../core/CanonicalJson.js';

/**
 * RFC 8785 §Appendix B test vectors.
 * Reference: https://www.rfc-editor.org/rfc/rfc8785#appendix-B
 */
describe('canonicalJson — RFC 8785 test vectors', () => {
  test('null', () => expect(canonicalJson(null)).toBe('null'));
  test('true', () => expect(canonicalJson(true)).toBe('true'));
  test('false', () => expect(canonicalJson(false)).toBe('false'));
  test('integer', () => expect(canonicalJson(1)).toBe('1'));
  test('negative integer', () => expect(canonicalJson(-1)).toBe('-1'));
  test('float', () => expect(canonicalJson(3.14)).toBe('3.14'));

  test('empty string', () => expect(canonicalJson('')).toBe('""'));
  test('simple string', () => expect(canonicalJson('hello')).toBe('"hello"'));
  test('string with backslash', () => expect(canonicalJson('a\\b')).toBe('"a\\\\b"'));
  test('string with quote', () => expect(canonicalJson('a"b')).toBe('"a\\"b"'));
  test('string with control chars', () => expect(canonicalJson('\t\n')).toBe('"\\t\\n"'));
  test('string with low control char', () => expect(canonicalJson('')).toBe('"\\u0001"'));

  test('empty object', () => expect(canonicalJson({})).toBe('{}'));
  test('empty array', () => expect(canonicalJson([])).toBe('[]'));

  test('object keys sorted', () =>
    expect(canonicalJson({ b: 2, a: 1 })).toBe('{"a":1,"b":2}'));

  test('nested object keys sorted', () =>
    expect(canonicalJson({ z: { b: 2, a: 1 }, a: 0 }))
      .toBe('{"a":0,"z":{"a":1,"b":2}}'));

  test('array preserves order', () =>
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]'));

  test('mixed nested', () =>
    expect(canonicalJson({ b: [2, 1], a: { y: 'z', x: 'w' } }))
      .toBe('{"a":{"x":"w","y":"z"},"b":[2,1]}'));

  test('unicode passthrough', () =>
    expect(canonicalJson('café')).toBe('"café"'));

  test('throws on non-finite', () =>
    expect(() => canonicalJson(Infinity)).toThrow('non-finite'));

  test('throws on NaN', () =>
    expect(() => canonicalJson(NaN)).toThrow('non-finite'));
});
