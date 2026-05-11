import { OODAController } from '../core/ooda.js';

describe('OODAController', () => {
  test('not escalated below escalationCount', () => {
    const ctrl = new OODAController({ escalationCount: 3, windowMs: 60_000, escalationFactor: 0.9 });
    ctrl.observe(1000);
    ctrl.observe(2000);
    expect(ctrl.isEscalated).toBe(false);
    expect(ctrl.effectiveThresholds()).toEqual({ restrict: 0.5, lockout: 0.7, kill: 0.9 });
  });

  test('escalates at escalationCount', () => {
    const ctrl = new OODAController({ escalationCount: 3, windowMs: 60_000, escalationFactor: 0.9 });
    ctrl.observe(1000);
    ctrl.observe(2000);
    ctrl.observe(3000);
    expect(ctrl.isEscalated).toBe(true);
    const t = ctrl.effectiveThresholds();
    expect(t.restrict).toBeCloseTo(0.45);
    expect(t.lockout).toBeCloseTo(0.63);
    expect(t.kill).toBeCloseTo(0.81);
  });

  test('de-escalates after window expires', () => {
    jest.useFakeTimers();
    const ctrl = new OODAController({ escalationCount: 3, windowMs: 5_000, escalationFactor: 0.9 });
    const base = Date.now();
    ctrl.observe(base);
    ctrl.observe(base + 100);
    ctrl.observe(base + 200);
    expect(ctrl.isEscalated).toBe(true);

    jest.advanceTimersByTime(6_000);
    // windowEventCount prunes stale entries
    expect(ctrl.windowEventCount).toBe(0);
    expect(ctrl.isEscalated).toBe(false);
    jest.useRealTimers();
  });

  test('custom base thresholds are respected', () => {
    const ctrl = new OODAController(
      { escalationCount: 2, windowMs: 60_000, escalationFactor: 0.8 },
      { restrict: 0.6, lockout: 0.75, kill: 0.95 },
    );
    ctrl.observe(1000);
    ctrl.observe(2000);
    const t = ctrl.effectiveThresholds();
    expect(t.restrict).toBeCloseTo(0.48);
    expect(t.lockout).toBeCloseTo(0.60);
    expect(t.kill).toBeCloseTo(0.76);
  });

  test('observe returns effective thresholds at call time', () => {
    const ctrl = new OODAController({ escalationCount: 2, windowMs: 60_000, escalationFactor: 0.9 });
    const t1 = ctrl.observe(1000); // below threshold — base thresholds
    expect(t1.kill).toBe(0.9);
    const t2 = ctrl.observe(2000); // at threshold — escalated thresholds
    expect(t2.kill).toBeCloseTo(0.81);
  });
});
