import type { Detector, DetectorResult } from './Detector.js';

const JAILBREAK_PATHS = [
  '/Applications/Cydia.app',
  '/Library/MobileSubstrate/MobileSubstrate.dylib',
  '/bin/bash',
  '/usr/sbin/sshd',
  '/etc/apt',
  '/private/var/lib/apt/',
] as const;

export class JailbreakDetector implements Detector {
  readonly threatId = 'jailbreak' as const;
  readonly severity = 'high' as const;

  async run(): Promise<DetectorResult> {
    const simulateJailbreak = process.env['GUARDIAN_SIMULATE_JAILBREAK'] === '1';
    if (!simulateJailbreak) {
      return { detected: false, confidence: 0.05, evidence: { method: 'js-stub' } };
    }
    return {
      detected: true,
      confidence: 0.95,
      evidence: {
        method: 'simulated',
        paths: JAILBREAK_PATHS.join(','),
      },
    };
  }
}
