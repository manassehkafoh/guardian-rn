import type { Detector, DetectorResult } from './Detector.js';

const ROOT_BINARIES = ['su', 'busybox', 'magisk', 'daemonsu'] as const;
const ROOT_PATHS = [
  '/system/app/Superuser.apk',
  '/system/xbin/su',
  '/system/bin/su',
  '/sbin/su',
  '/data/local/xbin/su',
  '/data/local/bin/su',
  '/data/local/su',
] as const;

export class RootDetector implements Detector {
  readonly threatId = 'root' as const;
  readonly severity = 'high' as const;

  async run(): Promise<DetectorResult> {
    // In a real RN runtime this delegates to native via TurboModule.
    // In Node test environment we simulate based on environment variables
    // so tests can exercise the scoring logic without native code.
    const simulateRoot = process.env['GUARDIAN_SIMULATE_ROOT'] === '1';
    if (!simulateRoot) {
      return { detected: false, confidence: 0.1, evidence: { method: 'js-stub' } };
    }
    return {
      detected: true,
      confidence: 0.95,
      evidence: {
        method: 'simulated',
        paths: ROOT_PATHS.join(','),
        binaries: ROOT_BINARIES.join(','),
      },
    };
  }
}
