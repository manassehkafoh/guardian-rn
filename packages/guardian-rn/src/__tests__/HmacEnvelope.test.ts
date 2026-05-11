import { verifyEnvelope, computeHmac } from '../core/HmacEnvelope.js';
import { canonicalJson } from '../core/CanonicalJson.js';
import type { GuardianEnvelope } from '../core/HmacEnvelope.js';
import type { ThreatPayload } from '../core/ThreatPayload.js';

const SESSION_KEY = new Uint8Array(32).fill(0xab); // deterministic test key

const PAYLOAD: ThreatPayload = {
  threatId: 'debugger',
  severity: 'high',
  confidence: 0.97,
  evidence: { source: 'community-engine' },
  ts: 1715350800000,
};

function makeEnvelope(overrides: Partial<GuardianEnvelope> = {}): GuardianEnvelope {
  const canonical = canonicalJson(PAYLOAD);
  const hmac = computeHmac(canonical, SESSION_KEY);
  return {
    seq: 1,
    sessionId: 'test-session-uuid',
    ts: 1715350800000,
    hmac,
    payload: PAYLOAD,
    ...overrides,
  };
}

describe('HmacEnvelope', () => {
  // T-HMAC-1: payload tampered after signing → HMAC_MISMATCH
  test('T-HMAC-1: tampered payload byte is rejected', () => {
    const envelope = makeEnvelope({
      payload: { ...PAYLOAD, severity: 'low' }, // severity changed after signing
    });
    const result = verifyEnvelope(envelope, SESSION_KEY);
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.reason).toBe('HMAC_MISMATCH');
    }
  });

  // T-HMAC-4: wrong key → all events rejected
  test('T-HMAC-4: wrong session key is rejected', () => {
    const envelope = makeEnvelope();
    const wrongKey = new Uint8Array(32).fill(0x00);
    const result = verifyEnvelope(envelope, wrongKey);
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.reason).toBe('HMAC_MISMATCH');
    }
  });

  // Valid envelope passes
  test('valid envelope is accepted', () => {
    const envelope = makeEnvelope();
    const result = verifyEnvelope(envelope, SESSION_KEY);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.threatId).toBe('debugger');
    }
  });

  // HMAC is deterministic (same key + canonical payload → same HMAC)
  test('HMAC is deterministic', () => {
    const c = canonicalJson(PAYLOAD);
    const h1 = computeHmac(c, SESSION_KEY);
    const h2 = computeHmac(c, SESSION_KEY);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^sha256=[0-9a-f]{64}$/);
  });
});
