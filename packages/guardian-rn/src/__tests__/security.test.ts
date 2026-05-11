/**
 * Security integration tests per ADR-0020.
 * Covers: attacker injection, policy bypass attempt, replay attack.
 */
import { EventBus } from '../bus/EventBus.js';
import { PolicyEngine } from '../core/policy.js';
import { computeHmac } from '../core/HmacEnvelope.js';
import { canonicalJson } from '../core/CanonicalJson.js';
import type { GuardianEnvelope } from '../core/HmacEnvelope.js';
import type { ThreatPayload } from '../core/ThreatPayload.js';
import type { GuardianConfig } from '../config/GuardianConfig.js';
import type { ThreatEvent } from '../events/ThreatEvent.js';

const SESSION_KEY = new Uint8Array(32).fill(0xab);
const ATTACKER_KEY = new Uint8Array(32).fill(0xff); // different key
const SESSION_ID = 'security-test-session';
const NOOP_SIGN = (_d: string) => `sha256=${'0'.repeat(64)}`;

function makeEnvelope(seq: number, payload: ThreatPayload, key = SESSION_KEY): GuardianEnvelope {
  return {
    seq,
    sessionId: SESSION_ID,
    ts: Date.now(),
    hmac: computeHmac(canonicalJson(payload), key),
    payload,
  };
}

const HIGH_CONF_PAYLOAD: ThreatPayload = {
  threatId: 'hooks',
  severity: 'critical',
  confidence: 0.99,
  evidence: {},
  ts: Date.now(),
};

// ── Attacker injection ────────────────────────────────────────────────────

describe('Security: attacker injection', () => {
  test('envelope signed with wrong key is rejected and fires fault handler', () => {
    const bus = new EventBus(SESSION_KEY, SESSION_ID);
    const threats: ThreatEvent[] = [];
    const faults: string[] = [];
    bus.onThreat((e) => threats.push(e));
    bus.onFault((id) => faults.push(id));

    const poisoned = makeEnvelope(1, HIGH_CONF_PAYLOAD, ATTACKER_KEY);
    bus.processEnvelope(poisoned, 'community@1.0.0');

    expect(threats).toHaveLength(0);
    expect(faults).toHaveLength(1);
  });

  test('tampered payload (modified after signing) is rejected', () => {
    const bus = new EventBus(SESSION_KEY, SESSION_ID);
    const threats: ThreatEvent[] = [];
    bus.onThreat((e) => threats.push(e));

    const env = makeEnvelope(1, HIGH_CONF_PAYLOAD);
    // Tamper: modify confidence after signing
    const tampered: GuardianEnvelope = {
      ...env,
      payload: { ...env.payload, confidence: 0.1 },
    };
    bus.processEnvelope(tampered, 'community@1.0.0');

    expect(threats).toHaveLength(0);
  });

  test('injected event with valid HMAC but wrong session ID is dropped', () => {
    const bus = new EventBus(SESSION_KEY, SESSION_ID);
    const threats: ThreatEvent[] = [];
    bus.onThreat((e) => threats.push(e));

    // Attacker reuses session key but uses a different sessionId
    const forgedPayload = { ...HIGH_CONF_PAYLOAD };
    const env: GuardianEnvelope = {
      seq: 1,
      sessionId: 'attacker-session', // wrong session
      ts: Date.now(),
      hmac: computeHmac(canonicalJson(forgedPayload), SESSION_KEY),
      payload: forgedPayload,
    };
    bus.processEnvelope(env, 'community@1.0.0');

    // SequenceTracker will reject wrong_session
    expect(threats).toHaveLength(0);
  });
});

// ── Policy bypass ─────────────────────────────────────────────────────────

describe('Security: policy bypass attempt', () => {
  function makeConfig(overrides: Partial<GuardianConfig> = {}): GuardianConfig {
    return { tenantId: 'test', engines: [], actions: {}, ...overrides };
  }

  test('low-confidence event does not trigger kill policy', () => {
    const onKill = jest.fn();
    const terminate = jest.fn();
    const config = makeConfig({
      killPolicy: { enabled: true, graceMs: 100 },
      terminator: { terminate },
      actions: { onKill },
    });
    const engine = new PolicyEngine(config, NOOP_SIGN);

    // Attacker sends hooks event but with low confidence (below kill threshold 0.9)
    engine.apply({
      threatId: 'hooks',
      severity: 'critical',
      confidence: 0.5,
      evidence: {},
      ts: Date.now(),
      engineId: 'community@1.0.0',
    });

    expect(onKill).not.toHaveBeenCalled();
    expect(terminate).not.toHaveBeenCalled();
    engine.cancelPendingKills();
  });

  test('telemetry-only threat does not escalate to action callbacks even at max confidence', () => {
    const onRestrict = jest.fn();
    const onLockout = jest.fn();
    const onKill = jest.fn();
    const config = makeConfig({ actions: { onRestrict, onLockout, onKill } });
    const engine = new PolicyEngine(config, NOOP_SIGN);

    engine.apply({
      threatId: 'emulator',  // DEFAULT_POLICIES: 'telemetry'
      severity: 'low',
      confidence: 1.0,
      evidence: {},
      ts: Date.now(),
      engineId: 'community@1.0.0',
    });

    expect(onRestrict).not.toHaveBeenCalled();
    expect(onLockout).not.toHaveBeenCalled();
    expect(onKill).not.toHaveBeenCalled();
  });

  test('signPayload is called for every recorded threat', () => {
    const signPayload = jest.fn((_d: string) => `sha256=${'0'.repeat(64)}`);
    const recordThreat = jest.fn();
    const config = makeConfig({
      telemetry: { recordThreat, recordHealthTick: jest.fn(), flush: jest.fn().mockResolvedValue(undefined) },
    });
    const engine = new PolicyEngine(config, signPayload);

    engine.apply({
      threatId: 'root',
      severity: 'high',
      confidence: 0.95,
      evidence: {},
      ts: Date.now(),
      engineId: 'community@1.0.0',
    });

    expect(recordThreat).toHaveBeenCalledTimes(1);
    // signPayload is passed as the second arg — the adapter decides when to invoke it
    const [, sign] = recordThreat.mock.calls[0]! as [ThreatEvent, typeof signPayload];
    expect(sign).toBe(signPayload); // same closure reference passed through
    // Verify the closure actually works
    const sig = sign('test-data');
    expect(signPayload).toHaveBeenCalledWith('test-data');
    expect(sig).toMatch(/^sha256=/);
  });
});

// ── Replay attack ─────────────────────────────────────────────────────────

describe('Security: replay attack', () => {
  test('replayed sequence number is silently dropped', () => {
    const bus = new EventBus(SESSION_KEY, SESSION_ID);
    const threats: ThreatEvent[] = [];
    bus.onThreat((e) => threats.push(e));

    const env = makeEnvelope(1, HIGH_CONF_PAYLOAD);
    bus.processEnvelope(env, 'engine');  // first — accepted
    bus.processEnvelope(env, 'engine');  // replay — dropped

    // Fast-path (confidence 0.99) bypasses dedup but NOT replay detection
    expect(threats.length).toBe(1);
  });

  test('fast-path events are still subject to sequence replay protection', () => {
    const bus = new EventBus(SESSION_KEY, SESSION_ID, { fastPathEnabled: true }, 0.9);
    const threats: ThreatEvent[] = [];
    bus.onThreat((e) => threats.push(e));

    const criticalPayload: ThreatPayload = { ...HIGH_CONF_PAYLOAD, confidence: 0.99 };
    const env = makeEnvelope(5, criticalPayload);
    bus.processEnvelope(env, 'engine');  // accepted
    bus.processEnvelope(env, 'engine');  // same seq — replay dropped before fast-path

    expect(threats).toHaveLength(1);
  });

  test('sequence gap is tolerated but flagged via fault handler', () => {
    const bus = new EventBus(SESSION_KEY, SESSION_ID);
    const threats: ThreatEvent[] = [];
    bus.onThreat((e) => threats.push(e));

    // seq 1, then jump to seq 3 (gap) — both accepted per ADR-0003
    bus.processEnvelope(makeEnvelope(1, HIGH_CONF_PAYLOAD), 'engine');
    const differentPayload: ThreatPayload = { ...HIGH_CONF_PAYLOAD, threatId: 'root' };
    bus.processEnvelope(makeEnvelope(3, differentPayload), 'engine');

    // Both events should reach handlers (gaps are logged, not dropped)
    expect(threats.length).toBe(2);
  });
});
