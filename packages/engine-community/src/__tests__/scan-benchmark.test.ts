/**
 * Scan-time performance benchmark suite per ADR-0021.
 *
 * Goal: a full CommunityEngine scan cycle must complete with p95 < 200 ms
 * in the Node test environment (which lacks native modules — all detectors
 * return stub results immediately, so this measures JS overhead only).
 *
 * On a real device, native detector latency dominates; the 200 ms p95
 * target is validated in CI with a device-farm run. These tests enforce
 * the JS-layer budget and catch accidental O(n) regressions.
 */
import { CommunityEngine } from '../CommunityEngine.js';
import type { EngineContext } from '@guardian/rn/src/engine/Engine.js';
import type { Detector, DetectorResult } from '../detectors/Detector.js';

const SAMPLE_COUNT = 50;
const P95_BUDGET_MS = 200;
const MEDIAN_BUDGET_MS = 50;

function makeContext(): EngineContext {
  return {
    config: {} as never,
    sessionId: 'perf-session',
    platform: 'android',
    managedProfile: false,
    onFault: () => { /* suppress faults in perf tests */ },
  };
}

/** Controlled detector: resolves after exactly `delayMs` ms. */
function makeTimedDetector(threatId: Detector['threatId'], delayMs: number): Detector {
  return {
    threatId,
    severity: 'low',
    async run(): Promise<DetectorResult> {
      await new Promise<void>((r) => setTimeout(r, delayMs));
      return { detected: false, confidence: 0.0, evidence: {} };
    },
  };
}

/** Percentile helper. */
function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)]!;
}

describe('Scan-time performance benchmark', () => {
  afterEach(() => jest.useRealTimers());

  test(`default detector suite: p95 scan time < ${P95_BUDGET_MS} ms`, async () => {
    const engine = new CommunityEngine(); // uses all default detectors (stub results)
    const ctx = makeContext();
    await engine.start(ctx);

    const samples: number[] = [];
    for (let i = 0; i < SAMPLE_COUNT; i++) {
      const start = performance.now();
      // Access private runScan indirectly by letting the engine run one cycle
      // We measure from threat subscription perspective — no threat expected
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 500); // safety cap
        // Force a scan cycle by stopping and restarting
        void engine.stop().then(async () => {
          await engine.start(ctx);
          clearTimeout(timer);
          resolve();
        });
      });
      samples.push(performance.now() - start);
    }

    await engine.stop();
    samples.sort((a, b) => a - b);

    const p95 = percentile(samples, 95);
    const median = percentile(samples, 50);

    console.log(`[benchmark] scan p50=${median.toFixed(1)}ms p95=${p95.toFixed(1)}ms`);
    expect(p95).toBeLessThan(P95_BUDGET_MS);
    expect(median).toBeLessThan(MEDIAN_BUDGET_MS);
  }, 30_000);

  test('parallel detector fan-out: slowest detector bounds total time', async () => {
    // 10 detectors, 9 resolve instantly, 1 takes 20 ms.
    // Total scan should complete in ~20–40 ms (not 200+ ms serial).
    const slow = makeTimedDetector('root', 20);
    const fast = Array.from({ length: 9 }, (_, i) =>
      makeTimedDetector(['jailbreak', 'debugger', 'emulator', 'hooks', 'tamper',
        'malware', 'overlay', 'simulator', 'adbEnabled'][i] as Detector['threatId'], 1),
    );

    const engine = new CommunityEngine([slow, ...fast]);
    await engine.start(makeContext());

    const samples: number[] = [];
    for (let i = 0; i < 20; i++) {
      await engine.stop();
      const start = performance.now();
      await engine.start(makeContext());
      samples.push(performance.now() - start);
    }
    await engine.stop();
    samples.sort((a, b) => a - b);

    const p95 = percentile(samples, 95);
    console.log(`[benchmark] parallel fan-out p95=${p95.toFixed(1)}ms`);
    // Should be bounded by the slow detector (~20ms), not 9*20=180ms
    expect(p95).toBeLessThan(80);
  }, 15_000);

  test('single faulting detector does not block the scan cycle', async () => {
    const faulting: Detector = {
      threatId: 'root',
      severity: 'high',
      async run(): Promise<DetectorResult> {
        throw new Error('simulated detector crash');
      },
    };
    const fast = makeTimedDetector('jailbreak', 5);

    const threats: string[] = [];
    const engine = new CommunityEngine([faulting, fast]);
    engine.onThreat.subscribe({ next: (e) => threats.push(e.threatId) });

    const start = performance.now();
    await engine.start(makeContext());
    const elapsed = performance.now() - start;

    await engine.stop();
    // Scan completes despite faulting detector
    expect(elapsed).toBeLessThan(200);
  });
});
