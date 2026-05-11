import type { Detector, DetectorResult } from './Detector.js';

export class EmulatorDetector implements Detector {
  readonly threatId = 'emulator' as const;
  readonly severity = 'medium' as const;

  async run(): Promise<DetectorResult> {
    const simulateEmulator = process.env['GUARDIAN_SIMULATE_EMULATOR'] === '1';
    if (!simulateEmulator) {
      return { detected: false, confidence: 0.05, evidence: { method: 'js-stub' } };
    }
    return {
      detected: true,
      confidence: 0.9,
      evidence: {
        method: 'simulated',
        buildFingerprint: 'generic/generic/generic:10/QKQ1/12345:user/test-keys',
      },
    };
  }
}
