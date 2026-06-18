import { createHmac } from 'crypto';
import { canonicalJson } from './CanonicalJson.js';
import type { ThreatPayload } from './ThreatPayload.js';

export interface GuardianEnvelope {
  readonly seq: number;
  readonly sessionId: string;
  readonly ts: number;
  readonly hmac: string;
  readonly payload: ThreatPayload;
}

export type VerifyResult =
  | { ok: true; payload: ThreatPayload }
  | { ok: false; reason: InvariantBreach };

export type InvariantBreach =
  | 'HMAC_MISMATCH'
  | 'SEQUENCE_REPLAY'
  | 'SEQUENCE_GAP'
  | 'WRONG_SESSION';

/**
 * Verifies a single envelope against the per-session HMAC key.
 * Uses Node crypto (test / server) or the native HMAC bridge (RN runtime).
 * Does NOT track sequence state — use SequenceTracker for that.
 */
export function verifyEnvelope(
  envelope: GuardianEnvelope,
  key: Uint8Array,
): { ok: true; payload: ThreatPayload } | { ok: false; reason: 'HMAC_MISMATCH' } {
  const canonical = canonicalJson(envelope.payload);
  const expected = computeHmac(canonical, key);
  // trusted = expected, untrusted = envelope.hmac
  if (!constantTimeEqual(expected, envelope.hmac)) {
    return { ok: false, reason: 'HMAC_MISMATCH' };
  }
  return { ok: true, payload: envelope.payload };
}

export function computeHmac(canonicalPayload: string, key: Uint8Array): string {
  const mac = createHmac('sha256', key);
  mac.update(canonicalPayload, 'utf8');
  return 'sha256=' + mac.digest('hex');
}

// Security: constant-time comparison that avoids early returns
// and always loops over the length of the trusted string.
function constantTimeEqual(trusted: string, untrusted: string): boolean {
  let diff = trusted.length ^ untrusted.length;
  for (let i = 0; i < trusted.length; i++) {
    diff |= trusted.charCodeAt(i) ^ (untrusted.charCodeAt(i) | 0);
  }
  return diff === 0;
}
