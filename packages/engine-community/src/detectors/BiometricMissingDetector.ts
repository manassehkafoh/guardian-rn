import type { Detector, DetectorResult } from './Detector.js';

/**
 * Detects that the device has no biometric authenticator enrolled.
 *
 * Android: delegates to BiometricManager.canAuthenticate(BIOMETRIC_STRONG).
 * iOS: uses LAContext.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics).
 *
 * Missing biometrics is a softer signal than missing passcode — the policy
 * default is 'telemetry'. Tenants that mandate biometric step-up for sensitive
 * operations should escalate to 'restrict'.
 *
 * Per ADR-0023.
 */
export class BiometricMissingDetector implements Detector {
  readonly threatId = 'biometricMissing' as const;
  readonly severity = 'medium' as const;

  async run(): Promise<DetectorResult> {
    if (process.env['GUARDIAN_SIMULATE_BIOMETRIC_MISSING'] === '1') {
      return {
        detected: true,
        confidence: 0.9,
        evidence: { method: 'simulated' },
      };
    }

    try {
      const { NativeModules } = require('react-native') as {
        NativeModules: {
          GuardianDeviceAuth?: {
            isBiometricEnrolled(): Promise<boolean>;
          };
        };
      };

      const enrolled = await NativeModules.GuardianDeviceAuth?.isBiometricEnrolled();
      if (enrolled == null) {
        return { detected: false, confidence: 0.1, evidence: { method: 'js-stub' } };
      }

      return {
        detected: !enrolled,
        confidence: enrolled ? 0.0 : 0.9,
        evidence: { biometricEnrolled: String(enrolled) },
      };
    } catch {
      return { detected: false, confidence: 0.1, evidence: { method: 'js-stub' } };
    }
  }
}
