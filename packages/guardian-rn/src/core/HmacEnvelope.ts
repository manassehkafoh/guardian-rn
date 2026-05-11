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
  if (!constantTimeEqual(envelope.hmac, expected)) {
    return { ok: false, reason: 'HMAC_MISMATCH' };
  }
  return { ok: true, payload: envelope.payload };
}

export function computeHmac(canonicalPayload: string, key: Uint8Array): string {
  const mac = createHmac('sha256', key);
  mac.update(canonicalPayload, 'utf8');
  return 'sha256=' + mac.digest('hex');
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
