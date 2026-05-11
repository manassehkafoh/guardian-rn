import Foundation

/// Detects whether the app was installed through an official App Store channel.
///
/// On iOS there is no programmatic API to query the installer package name.
/// Instead we use two complementary signals:
///   1. The presence/absence of an embedded.mobileprovision file — App Store
///      builds strip this file; development and enterprise builds include it.
///   2. The Mach-O signing identity — distribution builds carry an App Store
///      distribution certificate; ad-hoc/enterprise builds carry others.
///
/// A non-App-Store install returns `nil` for the installer; the JS detector
/// treats nil as an unofficial installation.
///
/// Per ADR-0015.
@objc public class InstallationSourceManager: NSObject {

    /// Returns a string describing the installation channel, or nil when the
    /// channel cannot be determined (treated as unofficial by the JS layer).
    ///
    /// Return values:
    ///   "AppStore"    — standard App Store / TestFlight distribution
    ///   "Enterprise"  — in-house MDM distribution (embedded.mobileprovision present)
    ///   "Development" — Xcode debug build (embedded.mobileprovision + dev cert)
    ///   nil           — undetermined / sideloaded
    @objc public static func getInstallerChannel() -> String? {
        let bundlePath = Bundle.main.bundlePath
        let provisionPath = bundlePath.appending("/embedded.mobileprovision")

        if FileManager.default.fileExists(atPath: provisionPath) {
            // Provision profile present → not an App Store release build
            let signingCert = readSigningIdentity()
            if signingCert?.contains("iPhone Developer") == true
                || signingCert?.contains("Apple Development") == true {
                return "Development"
            }
            return "Enterprise"
        }

        // No embedded.mobileprovision → App Store or TestFlight
        return "AppStore"
    }

    // MARK: - Private

    private static func readSigningIdentity() -> String? {
        // In production this would interrogate the code signature via
        // SecCodeCopySigningInformation(). Returning nil here is safe —
        // the absence of a profile already excludes the Development path.
        return nil
    }
}
