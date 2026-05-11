import { PolicyEngine } from '../core/policy.js';
import type { GuardianConfig } from '../config/GuardianConfig.js';
import type { ThreatEvent } from '../events/ThreatEvent.js';

const NOOP_SIGN = (_data: string) => `sha256=${'0'.repeat(64)}`;

function makeConfig(overrides: Partial<GuardianConfig> = {}): GuardianConfig {
  return {
    tenantId: 'test-tenant',
    engines: [],
    actions: {},
    ...overrides,
  };
}

/**
 * Session expiry is emitted by useGuardian via a setTimeout.
 * These tests verify that the PolicyEngine correctly handles a
 * sessionExpiry ThreatEvent per DEFAULT_POLICIES['sessionExpiry'] = 'lockout'.
 */
describe('Session expiry policy', () => {
  test('sessionExpiry event triggers onLockout at confidence 1.0', () => {
    const onLockout = jest.fn();
    const config = makeConfig({ actions: { onLockout } });
    const engine = new PolicyEngine(config, NOOP_SIGN);

    const expiryEvent: ThreatEvent = {
      threatId: 'sessionExpiry',
      severity: 'high',
      confidence: 1.0,
      evidence: { sessionId: 'test-id', maxAgeMs: '3600000' },
      ts: Date.now(),
      engineId: 'guardian-rn/session',
    };

    engine.apply(expiryEvent);
    expect(onLockout).toHaveBeenCalledTimes(1);
    expect(onLockout).toHaveBeenCalledWith(expiryEvent);
  });

  test('sessionExpiry below lockout threshold does not trigger onLockout', () => {
    const onLockout = jest.fn();
    const config = makeConfig({ actions: { onLockout } });
    const engine = new PolicyEngine(config, NOOP_SIGN);

    engine.apply({
      threatId: 'sessionExpiry',
      severity: 'high',
      confidence: 0.5, // below lockout threshold of 0.7
      evidence: {},
      ts: Date.now(),
      engineId: 'guardian-rn/session',
    });

    expect(onLockout).not.toHaveBeenCalled();
  });

  test('sessionExpiry policy can be overridden to kill', () => {
    jest.useFakeTimers();
    const onKill = jest.fn();
    const terminate = jest.fn();
    const config = makeConfig({
      policies: { sessionExpiry: 'kill' },
      killPolicy: { enabled: true, graceMs: 100 },
      terminator: { terminate },
      actions: { onKill },
    });
    const engine = new PolicyEngine(config, NOOP_SIGN);

    engine.apply({
      threatId: 'sessionExpiry',
      severity: 'critical',
      confidence: 0.95,
      evidence: {},
      ts: Date.now(),
      engineId: 'guardian-rn/session',
    });

    expect(onKill).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(200);
    expect(terminate).toHaveBeenCalledTimes(1);
    engine.cancelPendingKills();
    jest.useRealTimers();
  });
});
