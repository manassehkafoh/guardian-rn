import { PolicyEngine, DEFAULT_POLICIES } from '../core/policy.js';
import type { GuardianConfig } from '../config/GuardianConfig.js';
import type { ThreatEvent } from '../events/ThreatEvent.js';
import type { TerminatorPort } from '../policy/TerminatorPort.js';

const NOOP_SIGN = (_data: string) => `sha256=${'0'.repeat(64)}`;

function makeEvent(overrides: Partial<ThreatEvent> = {}): ThreatEvent {
  return {
    threatId: 'root',
    severity: 'high',
    confidence: 0.95,
    evidence: {},
    ts: Date.now(),
    engineId: 'test',
    ...overrides,
  };
}

function makeConfig(overrides: Partial<GuardianConfig> = {}): GuardianConfig {
  return {
    tenantId: 'test-tenant',
    engines: [],
    actions: {},
    ...overrides,
  };
}

describe('PolicyEngine', () => {
  test('DEFAULT_POLICIES has entries for all major threats', () => {
    expect(DEFAULT_POLICIES['root']).toBe('lockout');
    expect(DEFAULT_POLICIES['hooks']).toBe('kill');
    expect(DEFAULT_POLICIES['emulator']).toBe('telemetry');
    expect(DEFAULT_POLICIES['repackaging']).toBe('kill');
  });

  test('telemetry-only threats do not invoke action callbacks', () => {
    const onRestrict = jest.fn();
    const config = makeConfig({ actions: { onRestrict } });
    const engine = new PolicyEngine(config, NOOP_SIGN);
    engine.apply(makeEvent({ threatId: 'emulator', confidence: 0.99 }));
    expect(onRestrict).not.toHaveBeenCalled();
  });

  test('telemetry adapter recordThreat called for every event', () => {
    const recordThreat = jest.fn();
    const config = makeConfig({
      telemetry: { recordThreat, recordHealthTick: jest.fn(), flush: jest.fn().mockResolvedValue(undefined) },
    });
    const engine = new PolicyEngine(config, NOOP_SIGN);
    engine.apply(makeEvent({ threatId: 'root', confidence: 0.95 }));
    expect(recordThreat).toHaveBeenCalledTimes(1);
  });

  test('restrict policy invokes onRestrict when confidence >= threshold', () => {
    const onRestrict = jest.fn();
    const config = makeConfig({
      policies: { debugger: 'restrict' },
      actions: { onRestrict },
    });
    const engine = new PolicyEngine(config, NOOP_SIGN);
    engine.apply(makeEvent({ threatId: 'debugger', confidence: 0.8 }));
    expect(onRestrict).toHaveBeenCalledTimes(1);
  });

  test('restrict policy does NOT fire when confidence < threshold', () => {
    const onRestrict = jest.fn();
    const config = makeConfig({
      policies: { debugger: 'restrict' },
      actions: { onRestrict },
    });
    const engine = new PolicyEngine(config, NOOP_SIGN);
    engine.apply(makeEvent({ threatId: 'debugger', confidence: 0.3 }));
    expect(onRestrict).not.toHaveBeenCalled();
  });

  test('lockout policy invokes onLockout when confidence >= 0.7', () => {
    const onLockout = jest.fn();
    const config = makeConfig({ actions: { onLockout } });
    const engine = new PolicyEngine(config, NOOP_SIGN);
    engine.apply(makeEvent({ threatId: 'root', confidence: 0.9 }));
    expect(onLockout).toHaveBeenCalledTimes(1);
  });

  test('kill policy invokes onKill and schedules terminator', async () => {
    jest.useFakeTimers();
    const onKill = jest.fn();
    const terminate = jest.fn();
    const terminator: TerminatorPort = { terminate };
    const config = makeConfig({
      killPolicy: { enabled: true, graceMs: 500 },
      terminator,
      actions: { onKill },
    });
    const engine = new PolicyEngine(config, NOOP_SIGN);
    engine.apply(makeEvent({ threatId: 'hooks', confidence: 0.99 }));
    expect(onKill).toHaveBeenCalledTimes(1);
    expect(terminate).not.toHaveBeenCalled();
    jest.advanceTimersByTime(600);
    expect(terminate).toHaveBeenCalledTimes(1);
    engine.cancelPendingKills();
    jest.useRealTimers();
  });

  test('cancelPendingKills prevents terminator from firing', async () => {
    jest.useFakeTimers();
    const terminate = jest.fn();
    const config = makeConfig({
      killPolicy: { enabled: true, graceMs: 500 },
      terminator: { terminate },
      actions: {},
    });
    const engine = new PolicyEngine(config, NOOP_SIGN);
    engine.apply(makeEvent({ threatId: 'hooks', confidence: 0.99 }));
    engine.cancelPendingKills();
    jest.advanceTimersByTime(1000);
    expect(terminate).not.toHaveBeenCalled();
    jest.useRealTimers();
  });

  test('kill timer is only scheduled once per threatId', () => {
    jest.useFakeTimers();
    const terminate = jest.fn();
    const config = makeConfig({
      killPolicy: { enabled: true, graceMs: 500 },
      terminator: { terminate },
      actions: {},
    });
    const engine = new PolicyEngine(config, NOOP_SIGN);
    engine.apply(makeEvent({ threatId: 'hooks', confidence: 0.99 }));
    engine.apply(makeEvent({ threatId: 'hooks', confidence: 0.99 })); // duplicate
    jest.advanceTimersByTime(600);
    expect(terminate).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });

  test('custom confidence thresholds are respected', () => {
    const onRestrict = jest.fn();
    const config = makeConfig({
      policies: { debugger: 'restrict' },
      confidenceThresholds: { restrict: 0.9 },
      actions: { onRestrict },
    });
    const engine = new PolicyEngine(config, NOOP_SIGN);
    // confidence 0.8 is < custom threshold 0.9
    engine.apply(makeEvent({ threatId: 'debugger', confidence: 0.8 }));
    expect(onRestrict).not.toHaveBeenCalled();
    // confidence 0.95 is >= custom threshold 0.9
    engine.apply(makeEvent({ threatId: 'debugger', confidence: 0.95 }));
    expect(onRestrict).toHaveBeenCalledTimes(1);
  });
});
