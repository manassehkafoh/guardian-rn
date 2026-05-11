import { verifyEnvelope, computeHmac } from '../core/HmacEnvelope.js';
import { canonicalJson } from '../core/CanonicalJson.js';
import { SequenceTracker } from '../core/SequenceTracker.js';
import type { GuardianEnvelope } from '../core/HmacEnvelope.js';
import type { ThreatPayload } from '../core/ThreatPayload.js';

// Reduced iteration count for unit test runs; the full 1 000 000 mutation
// run is a separate bench target (npm run bench:fuzz).
const ITERATIONS = process.env['FUZZ_ITERATIONS']
  ? parseInt(process.env['FUZZ_ITERATIONS']!, 10)
  : 5_000;

const SESSION_KEY = new Uint8Array(32).fill(0xde);
const SESSION_ID = 'fuzz-session';

const VALID_PAYLOAD: ThreatPayload = {
  threatId: 'root',
  severity: 'high',
  confidence: 0.95,
  evidence: { source: 'fuzz' },
  ts: 1715350800000,
};

function randomString(len: number): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789\x00\xff\n\t';
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

// Only mutate HMAC-covered fields (hmac string itself, or payload content).
// Mutations to seq/sessionId/ts are not covered by the HMAC and are tested
// separately in SequenceTracker fuzz below.
function mutateEnvelope(base: GuardianEnvelope, seed: number): GuardianEnvelope {
  const branch = seed % 5;
  switch (branch) {
    case 0: return { ...base, hmac: 'sha256=' + randomString(64) };
    case 1: return { ...base, hmac: randomString(72) };
    case 2: return { ...base, payload: { ...base.payload, threatId: 'debugger' as never } };
    case 3: return { ...base, hmac: '' };
    default: return { ...base, hmac: base.hmac.slice(0, -1) + 'x' }; // flip last char
  }
}

describe('Fuzz: verifyEnvelope', () => {
  test(`${ITERATIONS} mutated envelopes all return ok:false`, () => {
    const canonical = canonicalJson(VALID_PAYLOAD);
    const hmac = computeHmac(canonical, SESSION_KEY);
    const base: GuardianEnvelope = {
      seq: 1,
      sessionId: SESSION_ID,
      ts: VALID_PAYLOAD.ts,
      hmac,
      payload: VALID_PAYLOAD,
    };

    let passed = 0;
    for (let i = 0; i < ITERATIONS; i++) {
      const mutated = mutateEnvelope(base, i);
      // Skip mutations that accidentally produce the correct HMAC (astronomically unlikely)
      if (mutated.hmac === hmac && JSON.stringify(mutated.payload) === JSON.stringify(VALID_PAYLOAD)) continue;
      const result = verifyEnvelope(mutated, SESSION_KEY);
      if (result.ok) {
        throw new Error(`Fuzz iteration ${i} unexpectedly passed verification.\n${JSON.stringify(mutated)}`);
      }
      passed++;
    }
    expect(passed).toBeGreaterThan(ITERATIONS * 0.9);
  });
});

describe('Fuzz: SequenceTracker', () => {
  test(`${ITERATIONS} random sequences never throw`, () => {
    const tracker = new SequenceTracker(SESSION_ID);
    for (let i = 0; i < ITERATIONS; i++) {
      const seq = Math.floor(Math.random() * 0xffffffff);
      const sid = Math.random() > 0.95 ? 'other-session' : SESSION_ID;
      try {
        tracker.check(seq, sid);
      } catch (e) {
        throw new Error(`SequenceTracker threw at iteration ${i} with seq=${seq}: ${e}`);
      }
    }
  });
});

describe('Fuzz: canonicalJson', () => {
  test(`${ITERATIONS} random objects produce non-empty strings without throwing`, () => {
    for (let i = 0; i < ITERATIONS; i++) {
      const depth = (i % 4);
      const obj = buildRandomObject(depth, i);
      let result: string;
      try {
        result = canonicalJson(obj);
      } catch (e) {
        throw new Error(`canonicalJson threw at iteration ${i}: ${e}`);
      }
      if (typeof result !== 'string' || result.length === 0) {
        throw new Error(`canonicalJson returned empty at iteration ${i}`);
      }
    }
  });

  function buildRandomObject(depth: number, seed: number): unknown {
    if (depth === 0 || seed % 5 === 0) return seed % 3 === 0 ? null : seed % 7;
    if (seed % 4 === 0) return String.fromCharCode(seed % 128);
    const obj: Record<string, unknown> = {};
    const keys = ['b', 'a', 'z', 'A', '0'].slice(0, 1 + (seed % 5));
    for (const k of keys) {
      obj[k] = buildRandomObject(depth - 1, (seed * 31 + k.charCodeAt(0)) >>> 0);
    }
    return obj;
  }
});
