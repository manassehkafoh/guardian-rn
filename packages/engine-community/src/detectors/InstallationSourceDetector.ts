import type { Detector, DetectorResult } from './Detector.js';

/**
 * Detects installation from an unofficial app store.
 *
 * Android: queries PackageManager for the initiating install package.
 * Legitimate installs originate from com.android.vending (Play Store).
 * Any other installer (side-load, APK mirror, third-party store) scores high.
 *
 * iOS: checks whether the app is signed with a developer or enterprise
 * certificate rather than through the App Store distribution channel.
 *
 * In the test/JS environment, behaviour is driven by
 * GUARDIAN_SIMULATE_UNOFFICIAL_STORE=1.
 *
 * Per ADR-0015.
 */
export class InstallationSourceDetector implements Detector {
  readonly threatId = 'unofficialStore' as const;
  readonly severity = 'medium' as const;

  async run(): Promise<DetectorResult> {
    if (process.env['GUARDIAN_SIMULATE_UNOFFICIAL_STORE'] === '1') {
      return {
        detected: true,
        confidence: 0.9,
        evidence: { method: 'simulated', installer: 'unknown' },
      };
    }

    try {
      const { NativeModules } = require('react-native') as {
        NativeModules: {
          GuardianInstallationSource?: {
            getInstallerPackage(): Promise<string | null>;
          };
        };
      };

      const installer =
        await NativeModules.GuardianInstallationSource?.getInstallerPackage();

      if (installer == null) {
        // No native module available (test/simulator environment)
        return { detected: false, confidence: 0.1, evidence: { method: 'js-stub' } };
      }

      const isOfficial = OFFICIAL_INSTALLERS.has(installer);
      return {
        detected: !isOfficial,
        confidence: isOfficial ? 0.0 : 0.9,
        evidence: { installer },
      };
    } catch {
      return { detected: false, confidence: 0.1, evidence: { method: 'js-stub' } };
    }
  }
}

const OFFICIAL_INSTALLERS = new Set([
  'com.android.vending',      // Google Play Store
  'com.amazon.venezia',       // Amazon Appstore
  'com.sec.android.app.samsungapps', // Samsung Galaxy Store
  'com.huawei.appmarket',     // Huawei AppGallery
]);
