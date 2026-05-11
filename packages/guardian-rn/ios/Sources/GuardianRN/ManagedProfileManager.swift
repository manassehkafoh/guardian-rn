import Foundation

/// Detects whether the app is running under MDM management.
///
/// On iOS there is no direct equivalent of Android's managed work profile,
/// but MDM-enrolled devices can push managed configuration via Apple's
/// Managed App Configuration protocol. The presence of managed configuration
/// (NSUserDefaults with the "com.apple.configuration.managed" suite) is a
/// reliable signal that an MDM profile is active.
///
/// This is informational rather than adversarial — it contextualises
/// other detections rather than triggering restrictive policy on its own.
///
/// Per ADR-0019.
@objc public class ManagedProfileManager: NSObject {

    private static let managedConfigSuite = "com.apple.configuration.managed"

    /// Returns true when the app is running under MDM management.
    /// On iOS, true indicates Managed App Configuration is active.
    @objc public static func isRunningInManagedProfile() -> Bool {
        let defaults = UserDefaults(suiteName: managedConfigSuite)
        // The presence of the managed defaults suite (even if empty) indicates
        // that an MDM profile has applied managed configuration to this app.
        return defaults?.dictionaryRepresentation().isEmpty == false
    }

    /// Returns a descriptive string for the managing organisation, or nil.
    /// MDM vendors often populate "com.apple.configuration.managed" keys with
    /// organisation metadata — we surface the "OrganizationName" if present.
    @objc public static func getProfileOwnerPackage() -> String? {
        let defaults = UserDefaults(suiteName: managedConfigSuite)
        return defaults?.string(forKey: "OrganizationName")
            ?? defaults?.string(forKey: "organizationName")
    }
}
