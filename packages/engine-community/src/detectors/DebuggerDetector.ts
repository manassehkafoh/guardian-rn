import type { Detector, DetectorResult } from './Detector.js';

export class DebuggerDetector implements Detector {
  readonly threatId = 'debugger' as const;
  readonly severity = 'high' as const;

  async run(): Promise<DetectorResult> {
    const simulateDebugger = process.env['GUARDIAN_SIMULATE_DEBUGGER'] === '1';
    if (!simulateDebugger) {
      return { detected: false, confidence: 0.05, evidence: { method: 'js-stub' } };
    }
    return {
      detected: true,
      confidence: 0.98,
      evidence: {
        method: 'simulated',
        tracerPid: '12345',
      },
    };
  }
}
