import Foundation
import LocalAuthentication

/// Provides device authentication posture queries exposed via GuardianDeviceAuth TurboModule.
///
/// Mirrors the Android DeviceAuthManager contract:
///   isPasscodeSet()       — true when any device lock credential is set
///   isBiometricEnrolled() — true when Face ID or Touch ID is enrolled
///
/// Per ADR-0023.
@objc public class DeviceAuthManager: NSObject {

    /// Returns true when the device has a passcode (PIN or alphanumeric)
    /// configured. Uses LAContext.canEvaluatePolicy(.deviceOwnerAuthentication)
    /// which returns true for both biometric-and-passcode and passcode-only
    /// configurations.
    @objc public static func isPasscodeSet() -> Bool {
        let context = LAContext()
        var error: NSError?
        // .deviceOwnerAuthentication covers passcode OR biometrics
        let canEval = context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error)
        // LAError.passcodeNotSet is set when no passcode exists
        if let laError = error as? LAError, laError.code == .passcodeNotSet {
            return false
        }
        return canEval
    }

    /// Returns true when Face ID or Touch ID is enrolled on the device.
    @objc public static func isBiometricEnrolled() -> Bool {
        let context = LAContext()
        var error: NSError?
        let canEval = context.canEvaluatePolicy(
            .deviceOwnerAuthenticationWithBiometrics,
            error: &error,
        )
        if let laError = error as? LAError {
            // biometryNotEnrolled or biometryNotAvailable both indicate no enrollment
            if laError.code == .biometryNotEnrolled || laError.code == .biometryNotAvailable {
                return false
            }
        }
        return canEval
    }
}
