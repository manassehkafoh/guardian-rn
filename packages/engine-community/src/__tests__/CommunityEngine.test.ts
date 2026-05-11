import { CommunityEngine } from '../CommunityEngine.js';
import { EngineRegistry } from '../EngineRegistry.js';
import type { EngineContext } from '@guardian/rn/src/engine/Engine.js';
import type { ThreatEvent } from '@guardian/rn/src/events/ThreatEvent.js';
import type { Detector, DetectorResult } from '../detectors/Detector.js';

function makeContext(overrides: Partial<EngineContext> = {}): EngineContext {
  return {
    config: {} as never,
    sessionId: 'test-session',
    platform: 'android',
    managedProfile: false,
    onFault: jest.fn(),
    ...overrides,
  };
}

function makeDetector(
  threatId: Detector['threatId'],
  result: Partial<DetectorResult> = {},
): Detector {
  return {
    threatId,
    severity: 'high',
    run: jest.fn().mockResolvedValue({
      detected: false,
      confidence: 0.0,
      evidence: {},
      ...result,
    }),
  };
}

describe('CommunityEngine', () => {
  afterEach(() => {
    jest.clearAllMocks();
    delete process.env['GUARDIAN_SIMULATE_ROOT'];
  });

  test('id is community@1.0.0', () => {
    const engine = new CommunityEngine();
    expect(engine.id).toBe('community@1.0.0');
  });

  test('start() runs initial scan and emits health tick', async () => {
    const ctx = makeContext();
    const engine = new CommunityEngine([]);
    const healthTicks: unknown[] = [];
    engine.onHealthTick.subscribe({ next: (v) => healthTicks.push(v) });

    await engine.start(ctx);
    expect(healthTicks).toHaveLength(1);
    await engine.stop();
  });

  test('start() is idempotent', async () => {
    const ctx = makeContext();
    const detector = makeDetector('root');
    const engine = new CommunityEngine([detector]);

    await engine.start(ctx);
    await engine.start(ctx); // second call is a no-op
    expect(detector.run).toHaveBeenCalledTimes(1);
    await engine.stop();
  });

  test('stop() is idempotent', async () => {
    const engine = new CommunityEngine([]);
    await engine.start(makeContext());
    await engine.stop();
    await engine.stop(); // second call should not throw
  });

  test('detected threat with confidence >= 0.5 fires onThreat', async () => {
    const ctx = makeContext();
    const detector = makeDetector('root', { detected: true, confidence: 0.95, evidence: { path: '/sbin/su' } });
    const engine = new CommunityEngine([detector]);
    const threats: ThreatEvent[] = [];
    engine.onThreat.subscribe({ next: (e) => threats.push(e) });

    await engine.start(ctx);
    await engine.stop();

    expect(threats).toHaveLength(1);
    expect(threats[0]!.threatId).toBe('root');
    expect(threats[0]!.confidence).toBe(0.95);
    expect(threats[0]!.engineId).toBe('community@1.0.0');
  });

  test('detected threat with confidence < 0.5 is suppressed', async () => {
    const ctx = makeContext();
    const detector = makeDetector('emulator', { detected: true, confidence: 0.3 });
    const engine = new CommunityEngine([detector]);
    const threats: ThreatEvent[] = [];
    engine.onThreat.subscribe({ next: (e) => threats.push(e) });

    await engine.start(ctx);
    await engine.stop();

    expect(threats).toHaveLength(0);
  });

  test('detector error calls onFault, other detectors still run', async () => {
    const faultFn = jest.fn();
    const ctx = makeContext({ onFault: faultFn });

    const faultyDetector: Detector = {
      threatId: 'debugger',
      severity: 'high',
      run: jest.fn().mockRejectedValue(new Error('native crash')),
    };
    const goodDetector = makeDetector('root', { detected: true, confidence: 0.9 });

    const engine = new CommunityEngine([faultyDetector, goodDetector]);
    const threats: ThreatEvent[] = [];
    engine.onThreat.subscribe({ next: (e) => threats.push(e) });

    await engine.start(ctx);
    await engine.stop();

    expect(faultFn).toHaveBeenCalledWith(expect.any(Error));
    expect(threats).toHaveLength(1);
    expect(threats[0]!.threatId).toBe('root');
  });
});

describe('EngineRegistry', () => {
  test('register and startAll starts all engines', async () => {
    const registry = new EngineRegistry();
    const e1 = new CommunityEngine([]);
    const e2 = new CommunityEngine([]);
    // Give them unique ids by subclassing
    Object.defineProperty(e1, 'id', { value: 'community@1.0.0' });
    Object.defineProperty(e2, 'id', { value: 'community@2.0.0' });

    registry.register(e1);
    registry.register(e2);
    expect(registry.size).toBe(2);

    const ctx = makeContext();
    await registry.startAll(ctx);
    await registry.stopAll();
  });

  test('registering duplicate id throws', () => {
    const registry = new EngineRegistry();
    const e1 = new CommunityEngine([]);
    registry.register(e1);
    expect(() => registry.register(e1)).toThrow("already registered");
  });

  test('startAll is idempotent', async () => {
    const registry = new EngineRegistry();
    const ctx = makeContext();
    await registry.startAll(ctx);
    await registry.startAll(ctx); // no-op
    await registry.stopAll();
  });
});
