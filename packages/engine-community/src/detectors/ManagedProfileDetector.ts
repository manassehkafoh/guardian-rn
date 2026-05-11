import type { Detector, DetectorResult } from './Detector.js';

/**
 * Detects whether the app is running inside an Android managed work profile
 * (BYOD COPE/POCE scheme under MDM control, e.g. Intune, JAMF, Samsung KNOX).
 *
 * On Android, DevicePolicyManager.isProfileOwnerApp() / getManagedProfilesForUser()
 * indicate managed-profile context. On iOS, MDM-enrolled devices expose
 * managed configuration via NSUserDefaults(suiteName: "com.apple.configuration.managed").
 *
 * This detector always emits a result — it is informational rather than
 * adversarial. The evidence is stamped on subsequent telemetry events so
 * the backend can correlate policy violations with MDM posture.
 *
 * Per ADR-0019.
 */
export class ManagedProfileDetector implements Detector {
  readonly threatId = 'privilegedAccess' as const; // closest canonical ThreatId for MDM posture
  readonly severity = 'low' as const;

  async run(): Promise<DetectorResult> {
    if (process.env['GUARDIAN_SIMULATE_MANAGED_PROFILE'] === '1') {
      return {
        detected: true,
        confidence: 0.8,
        evidence: { method: 'simulated', profileOwner: 'com.example.mdm' },
      };
    }

    try {
      const { NativeModules } = require('react-native') as {
        NativeModules: {
          GuardianManagedProfile?: {
            isRunningInManagedProfile(): Promise<boolean>;
            getProfileOwnerPackage(): Promise<string | null>;
          };
        };
      };

      const isManaged =
        await NativeModules.GuardianManagedProfile?.isRunningInManagedProfile();
      if (isManaged == null) {
        return { detected: false, confidence: 0.0, evidence: { method: 'js-stub' } };
      }

      const owner =
        (await NativeModules.GuardianManagedProfile?.getProfileOwnerPackage()) ?? 'unknown';

      return {
        detected: isManaged,
        confidence: isManaged ? 0.8 : 0.0,
        evidence: { managed: String(isManaged), profileOwner: owner },
      };
    } catch {
      return { detected: false, confidence: 0.0, evidence: { method: 'js-stub' } };
    }
  }
}
