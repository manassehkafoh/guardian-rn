import type { Detector, DetectorResult } from './Detector.js';

/**
 * Detects that the device has no screen lock / passcode configured.
 *
 * Android: delegates to KeyguardManager.isDeviceSecure().
 * iOS: uses LAContext.canEvaluatePolicy(.deviceOwnerAuthentication).
 *
 * A device without a passcode cannot protect any credential or key material
 * stored in the secure enclave / Android Keystore with user-presence
 * requirements, making theft of the physical device a complete credential
 * compromise.
 *
 * Per ADR-0023.
 */
export class PasscodeMissingDetector implements Detector {
  readonly threatId = 'passcodeMissing' as const;
  readonly severity = 'high' as const;

  async run(): Promise<DetectorResult> {
    if (process.env['GUARDIAN_SIMULATE_PASSCODE_MISSING'] === '1') {
      return {
        detected: true,
        confidence: 1.0,
        evidence: { method: 'simulated' },
      };
    }

    try {
      const { NativeModules } = require('react-native') as {
        NativeModules: {
          GuardianDeviceAuth?: {
            isPasscodeSet(): Promise<boolean>;
          };
        };
      };

      const isSet = await NativeModules.GuardianDeviceAuth?.isPasscodeSet();
      if (isSet == null) {
        return { detected: false, confidence: 0.1, evidence: { method: 'js-stub' } };
      }

      return {
        detected: !isSet,
        confidence: isSet ? 0.0 : 1.0,
        evidence: { passcodeSet: String(isSet) },
      };
    } catch {
      return { detected: false, confidence: 0.1, evidence: { method: 'js-stub' } };
    }
  }
}
