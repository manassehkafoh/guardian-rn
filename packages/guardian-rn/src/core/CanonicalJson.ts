/**
 * RFC 8785 JSON Canonicalisation Scheme (JCS).
 * Rules: keys sorted by Unicode code-point, no insignificant whitespace,
 * shortest IEEE 754 representation, Unicode escapes where required.
 *
 * Used by both the native HMAC signer and the JS verifier (ADR-0003).
 * Test vectors: see src/__tests__/CanonicalJson.test.ts (RFC 8785 appendix).
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('CanonicalJson: non-finite number');
    return JSON.stringify(value);
  }
  if (typeof value === 'string') return encodeString(value);
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalJson).join(',') + ']';
  }
  if (typeof value === 'object') {
    const sorted = Object.keys(value as Record<string, unknown>)
      .sort()
      .map((k) => encodeString(k) + ':' + canonicalJson((value as Record<string, unknown>)[k]));
    return '{' + sorted.join(',') + '}';
  }
  throw new Error(`CanonicalJson: unsupported type ${typeof value}`);
}

function encodeString(s: string): string {
  const out: string[] = ['"'];
  let last = 0;
  for (let i = 0; i < s.length; i++) {
    const cp = s.codePointAt(i) ?? 0;

    let esc = '';
    if (cp === 0x08) { esc = '\\b'; }
    else if (cp === 0x09) { esc = '\\t'; }
    else if (cp === 0x0a) { esc = '\\n'; }
    else if (cp === 0x0c) { esc = '\\f'; }
    else if (cp === 0x0d) { esc = '\\r'; }
    else if (cp === 0x22) { esc = '\\"'; }
    else if (cp === 0x5c) { esc = '\\\\'; }
    else if (cp < 0x20) { esc = '\\u' + cp.toString(16).padStart(4, '0'); }

    if (esc !== '') {
      if (last < i) {
        out.push(s.slice(last, i));
      }
      out.push(esc);
      last = i + 1;
    }

    if (cp > 0xffff) {
      i++; // surrogate pair
    }
  }
  if (last < s.length) {
    out.push(s.slice(last));
  }
  out.push('"');
  return out.join('');
}
