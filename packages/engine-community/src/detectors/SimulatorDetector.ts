import type { Detector, DetectorResult } from './Detector.js';

export class SimulatorDetector implements Detector {
  readonly threatId = 'simulator' as const;
  readonly severity = 'medium' as const;

  async run(): Promise<DetectorResult> {
    const simulateSim = process.env['GUARDIAN_SIMULATE_SIMULATOR'] === '1';
    if (!simulateSim) {
      return { detected: false, confidence: 0.05, evidence: { method: 'js-stub' } };
    }
    return {
      detected: true,
      confidence: 0.99,
      evidence: {
        method: 'simulated',
        targetEnvironment: 'iphonesimulator',
      },
    };
  }
}
