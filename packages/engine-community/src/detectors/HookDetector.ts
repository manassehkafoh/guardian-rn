import type { Detector, DetectorResult } from './Detector.js';

const KNOWN_HOOK_PACKAGES = ['de.robv.android.xposed.installer', 'com.saurik.substrate'] as const;

export class HookDetector implements Detector {
  readonly threatId = 'hooks' as const;
  readonly severity = 'critical' as const;

  async run(): Promise<DetectorResult> {
    const simulateHooks = process.env['GUARDIAN_SIMULATE_HOOKS'] === '1';
    if (!simulateHooks) {
      return { detected: false, confidence: 0.05, evidence: { method: 'js-stub' } };
    }
    return {
      detected: true,
      confidence: 0.99,
      evidence: {
        method: 'simulated',
        packages: KNOWN_HOOK_PACKAGES.join(','),
      },
    };
  }
}
